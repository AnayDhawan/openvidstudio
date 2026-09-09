import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath, spawnCapture } from "../util";
import {
  buildAdbCleanupArgs,
  buildAdbPullArgs,
  buildAdbRecordArgs,
  buildRemuxArgs,
  buildSimctlRecordArgs,
  sanitizeDeviceId,
  spawnForDuration,
} from "../nativeCapture";
import { runTool } from "./mcp";

export type MobilePlatform = "android" | "ios-simulator";

export interface CaptureMobileInput {
  projectRoot?: string;
  beatId: string;
  device: MobilePlatform;
  deviceId?: string;
  durationSeconds: number;
  outPath?: string;
}

export interface CaptureMobileResult {
  outPath: string;
  device: MobilePlatform;
  deviceId: string;
  durationSeconds: number;
}

/** `screenrecord` writes to the device, so it needs a device-side path first. */
const DEVICE_TMP = "/sdcard/openvidstudio-capture.mp4";

async function captureAndroid(
  beatId: string,
  deviceId: string | undefined,
  durationSeconds: number,
  outPathAbs: string,
  projectRoot: string,
): Promise<void> {
  // Android's screenrecord caps at 180s and silently truncates past it rather than failing.
  if (durationSeconds > 180) {
    throw new Error(
      `Android screenrecord has a hard 180 second limit and truncates silently past it. ` +
        `Requested ${durationSeconds}s. Split this into multiple beats.`,
    );
  }

  const record = await spawnCapture("adb", buildAdbRecordArgs(DEVICE_TMP, durationSeconds, deviceId), projectRoot);
  if (record.code !== 0) {
    const tail = record.stderr.slice(-800);
    if (/device not found|no devices|unauthorized/i.test(tail)) {
      throw new Error(
        `No usable Android device. Run "adb devices" and confirm exactly one shows as "device" (not "unauthorized", ` +
          `which means the USB debugging prompt on the phone has not been accepted yet). Pass deviceId to pick ` +
          `between several. Original adb output:\n${tail}`,
      );
    }
    if (/not found|is not recognized|ENOENT/i.test(tail)) {
      throw new Error(
        `adb is not on PATH. Install Android platform-tools and add it, then re-run. Original error:\n${tail}`,
      );
    }
    throw new Error(`adb screenrecord failed:\n${tail}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-mobile-"));
  try {
    const pulled = path.join(tmpDir, "device.mp4");
    const pull = await spawnCapture("adb", buildAdbPullArgs(DEVICE_TMP, pulled, deviceId), projectRoot);
    if (pull.code !== 0 || !fs.existsSync(pulled)) {
      throw new Error(`adb pull failed, the recording stayed on the device:\n${pull.stderr.slice(-800)}`);
    }
    // screenrecord emits mp4 without a faststart atom, so Remotion can decode it but not seek it.
    const remux = await spawnCapture("ffmpeg", buildRemuxArgs(pulled, outPathAbs), projectRoot);
    if (remux.code !== 0) {
      throw new Error(`ffmpeg remux failed:\n${remux.stderr.slice(-800)}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await spawnCapture("adb", buildAdbCleanupArgs(DEVICE_TMP, deviceId), projectRoot).catch(() => {});
  }
}

async function captureIosSimulator(
  deviceId: string,
  durationSeconds: number,
  outPathAbs: string,
  projectRoot: string,
): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error(
      `iOS Simulator capture requires macOS and Xcode command line tools; this is ${process.platform}. ` +
        `A physical iPhone cannot be captured headlessly on any platform, it needs QuickTime on a Mac.`,
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-mobile-"));
  try {
    const raw = path.join(tmpDir, "sim.mp4");
    // simctl records until interrupted, so the timer IS the duration control and a
    // timer-triggered stop is the success path, not a failure.
    const result = await spawnForDuration(
      "xcrun",
      buildSimctlRecordArgs(raw, deviceId),
      projectRoot,
      durationSeconds * 1000,
    );
    if (!fs.existsSync(raw)) {
      const tail = result.stderr.slice(-800);
      if (/No devices are booted|Unable to boot/i.test(tail)) {
        throw new Error(
          `No booted simulator. Start one with "xcrun simctl boot <udid>" or open Simulator.app, then re-run. ` +
            `Original output:\n${tail}`,
        );
      }
      throw new Error(`simctl recordVideo produced no file:\n${tail}`);
    }
    const remux = await spawnCapture("ffmpeg", buildRemuxArgs(raw, outPathAbs), projectRoot);
    if (remux.code !== 0) {
      throw new Error(`ffmpeg remux failed:\n${remux.stderr.slice(-800)}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function runCaptureMobile(input: CaptureMobileInput): Promise<CaptureMobileResult> {
  const beatId = sanitizeSegment(input.beatId, "beatId");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const deviceId = input.deviceId ? sanitizeDeviceId(input.deviceId) : undefined;

  if (!(input.durationSeconds > 0)) {
    throw new Error("durationSeconds must be a positive number: a screen recording has no natural end to detect.");
  }

  const outPathRel = input.outPath ?? path.join("public", "video", `${beatId}.mp4`);
  sanitizeRelativeOutPath(projectRoot, outPathRel, "outPath");
  const outPathAbs = path.join(projectRoot, outPathRel);
  fs.mkdirSync(path.dirname(outPathAbs), { recursive: true });

  if (input.device === "android") {
    await captureAndroid(beatId, deviceId, input.durationSeconds, outPathAbs, projectRoot);
  } else {
    await captureIosSimulator(deviceId ?? "booted", input.durationSeconds, outPathAbs, projectRoot);
  }

  return {
    outPath: outPathAbs,
    device: input.device,
    deviceId: deviceId ?? (input.device === "android" ? "(only device)" : "booted"),
    durationSeconds: input.durationSeconds,
  };
}

export function registerCaptureMobile(server: McpServer): void {
  server.registerTool(
    "capture_mobile",
    {
      title: "Record an Android device or iOS Simulator",
      description:
        "Records a real mobile app from a real device, for products that ship on a phone and therefore have no " +
        "URL a browser can drive. Android goes through adb screenrecord on the device, then pull, then an ffmpeg " +
        "remux (screenrecord writes mp4 without a faststart atom, which Remotion can decode but not seek); note " +
        "Android caps recordings at 180 seconds and truncates silently past it, so this tool refuses longer " +
        "requests rather than returning a short file. iOS uses xcrun simctl against a booted Simulator, stopped " +
        "on a timer with SIGINT so the container finalizes properly; it requires macOS, and a physical iPhone " +
        "cannot be captured headlessly on any platform. Pass deviceId (an adb serial or a simulator UDID) to " +
        "choose between several attached devices. Missing adb, an unauthorized phone, and an unbooted simulator " +
        "each return the specific command that fixes them. Writes public/video/<beatId>.mp4 by default, matching " +
        "scaffold_scene's real-recording convention.",
      inputSchema: {
        projectRoot: z.string().optional(),
        beatId: z.string().min(1),
        device: z.enum(["android", "ios-simulator"]),
        deviceId: z.string().optional().describe("adb serial or simulator UDID. Omit when exactly one device is attached."),
        durationSeconds: z.number().positive(),
        outPath: z.string().optional(),
      },
    },
    async (input) => runTool("capture_mobile", () => runCaptureMobile(input)),
  );
}

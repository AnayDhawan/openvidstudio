// js-yaml 4 ships no types and the scenario reader uses one function from it. Declared here rather
// than adding @types/js-yaml for a single call. `load` is js-yaml's safe loader: it builds plain data
// only, never functions or class instances.
declare module "js-yaml" {
  export function load(text: string): unknown;
}

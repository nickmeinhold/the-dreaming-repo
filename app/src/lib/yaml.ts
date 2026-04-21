import { stringify } from "yaml";

export function dump(data: unknown): string {
  return stringify(data, { lineWidth: 0 });
}

import { readdirSync, readFileSync } from "node:fs";
import { expect } from "vitest";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { outputSchemaFor } from "../src/lib/catalog.js";

const dir = join(process.cwd(), "schemas");
const ajv = new Ajv2020({ allErrors: true });
for (const file of readdirSync(dir)) {
  ajv.addSchema(JSON.parse(readFileSync(join(dir, file), "utf8")));
}

export function schemaErrors(envelope: { command: string | null; data: unknown }): string[] {
  const errors: string[] = [];
  const check = (id: string, value: unknown) => {
    const validate = ajv.getSchema(id);
    if (!validate) return errors.push(`no schema ${id}`);
    if (!validate(value)) errors.push(...(validate.errors ?? []).map((e) => `${id.split("/").pop()} ${e.instancePath} ${e.message}`));
  };
  check(outputSchemaFor("envelope"), envelope);
  if (envelope.command && envelope.data !== null) check(outputSchemaFor(envelope.command), envelope.data);
  return errors;
}

export function parseEnvelope(stdout: string): unknown {
  const envelope = JSON.parse(stdout);
  expect(schemaErrors(envelope), envelope.command).toEqual([]);
  return envelope;
}

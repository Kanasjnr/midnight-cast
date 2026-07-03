export function stripControlChars(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function sanitizeForOutput(text: string): string {
  return stripControlChars(text);
}

export type ErrorCode =
  | "INVALID_BODY"
  | "UNKNOWN_MUTATION"
  | "INVALID_ARGS"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL";

export function errorBody(code: ErrorCode, message: string) {
  return { error: { code, message } };
}

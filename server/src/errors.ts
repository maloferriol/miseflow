export type ErrorCode =
  | "INVALID_BODY"
  | "UNKNOWN_MUTATION"
  | "INVALID_ARGS"
  | "INVALID_QUERY"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL";

export function errorBody(code: ErrorCode, message: string) {
  return { error: { code, message } };
}

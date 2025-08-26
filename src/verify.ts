export function verify(
  cairo_proof_json: string,
  with_pedersen: boolean
): boolean {
  if (cairo_proof_json && with_pedersen) {
    return true; // TODO
  }
  return false;
}

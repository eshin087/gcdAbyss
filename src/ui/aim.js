// Aim without a mouse (touch controls and the gamepad): where game.mouseGround goes this frame.
// The player, the camera look-ahead and every attack read game.mouseGround as "the cursor", so a
// layer without a cursor parks it: on the boss's lock point while the boss is targetable and within
// `range` (auto-aim), otherwise `distance` m ahead of the hero along `dir` (seeded from the hero's
// facing the first time). Returns true when it auto-aimed.

const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * @param game  the game context (player, dragon, mouseGround)
 * @param dir   { x, z, set }: the fallback aim direction on the ground (unit), set = seeded
 * @param range m: auto-aim range (0 = never auto-aim)
 * @param distance m: how far ahead of the hero the fallback aim sits
 * @param v     a scratch vector for the boss's lock point
 */
export function aimWithoutCursor(game, dir, range, distance, v) {
  const p = game.player, mg = game.mouseGround, pos = p?.position;
  if (!pos || !mg) return false;
  const d = game.dragon;
  if (range > 0 && p.alive !== false && typeof d?.isTargetable === 'function' && typeof d.lockPoint === 'function' && d.isTargetable()) {
    d.lockPoint(v);
    const dx = v.x - pos.x, dz = v.z - pos.z;
    if (Number.isFinite(dx + dz) && dx * dx + dz * dz <= range * range) {
      mg.set(v.x, 0, v.z);
      return true;
    }
  }
  if (!dir.set) {
    const y = fin(p.yaw, Math.PI);
    dir.x = Math.sin(y);
    dir.z = Math.cos(y);
    dir.set = true;
  }
  mg.set(pos.x + dir.x * distance, 0, pos.z + dir.z * distance);
  return false;
}

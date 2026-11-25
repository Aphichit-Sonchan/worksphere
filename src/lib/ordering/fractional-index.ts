/**
 * Lexicographical Fractional Indexing (Base-36 lowercase: 0-9 < a-z)
 * ใช้เฉพาะตัวเลขและตัวพิมพ์เล็กเพื่อให้ลำดับตรงกัน 100% ทั้งใน ASCII, JavaScript และ PostgreSQL UTF-8 Collation
 */

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length; // 36
const MID_CHAR = DIGITS[Math.floor(BASE / 2)]!; // 'i' (index 18)

function charIndex(ch: string): number {
  const idx = DIGITS.indexOf(ch);
  if (idx < 0) throw new Error(`Invalid fractional index character: "${ch}"`);
  return idx;
}

function stripTrailingZeros(s: string): string {
  let end = s.length;
  while (end > 1 && s[end - 1] === DIGITS[0]) {
    end -= 1;
  }
  return s.slice(0, end);
}

export function comparePositions(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * คำนวณค่า string `pos` ที่รับประกันว่า `before < pos < after`
 */
export function generatePositionBetween(
  before: string | null | undefined,
  after: string | null | undefined,
): string {
  const a = before || "";
  const b = after || "";

  if (a && b && a >= b) {
    throw new Error(
      `Invalid bounds: before ("${a}") must be lexicographically less than after ("${b}")`,
    );
  }

  if (!a && !b) {
    return MID_CHAR;
  }

  let result = "";
  let i = 0;
  let upperBoundActive = Boolean(b);

  while (true) {
    const digitA = i < a.length ? charIndex(a[i]!) : 0;
    const digitB = upperBoundActive && i < b.length ? charIndex(b[i]!) : BASE;

    if (digitB - digitA > 1) {
      const mid = Math.floor((digitA + digitB) / 2);
      result += DIGITS[mid]!;
      return stripTrailingZeros(result);
    }

    result += DIGITS[digitA]!;
    if (digitA < digitB) {
      upperBoundActive = false;
    }

    i += 1;
    if (i > 64) {
      return `${a}${MID_CHAR}`;
    }
  }
}

/** สร้างลำดับเริ่มต้นจำนวน `count` รายการที่กระจายห่างกันสม่ำเสมอ */
export function generateInitialPositions(count: number): string[] {
  const out: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < count; i++) {
    const next = generatePositionBetween(prev, null);
    out.push(next);
    prev = next;
  }
  return out;
}

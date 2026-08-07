// 23 Feb 2010. Month is 0-indexed, so 1 is February.
const BIRTHDAY = [2010, 1, 23]

// Dividing elapsed milliseconds by an average year (365.25 days) drifts against
// the leap cycle, so the number flipped up to half a day late on half of all
// birthdays. Comparing calendar fields is exact on the day.
//
// Called during setup rather than onMounted so the pre-render emits the real
// age instead of whatever the ref was seeded with.
export function calcAge(now = new Date()) {
  const [y, m, d] = BIRTHDAY
  let age = now.getFullYear() - y
  const monthDiff = now.getMonth() - m
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d)) age--
  return age
}

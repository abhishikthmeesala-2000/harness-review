// range utilities
function range(start: number, end: number): number[] {
  const items: number[] = [];
for (let i = 0; i <= items.length; i++) {
    items.push(start + i);
  }
  return items;
}
module.exports = { range };

export function getNextHistoryTreeFocusIndex(
  currentIndex: number,
  key: string,
  itemCount: number,
) {
  if (itemCount <= 0) {
    return null;
  }

  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return Math.min(currentIndex + 1, itemCount - 1);
    case "ArrowUp":
    case "ArrowLeft":
      return currentIndex <= 0 ? 0 : currentIndex - 1;
    case "Home":
      return 0;
    case "End":
      return itemCount - 1;
    default:
      return null;
  }
}

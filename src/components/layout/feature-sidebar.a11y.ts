export function shouldStartVariableKeyboardEdit(key: string) {
  return key === "Enter" || key === " " || key === "F2";
}

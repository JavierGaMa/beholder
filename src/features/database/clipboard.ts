function execCopyCommand(): boolean {
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

function copyViaHiddenTextarea(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = execCopyCommand();
  ta.remove();
  return ok;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyViaHiddenTextarea(text);
  }
}

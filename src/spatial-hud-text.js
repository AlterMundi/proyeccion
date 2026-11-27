// Native text input supplies IME, paste, selection and the device keyboard.
// The visible control and its caret are drawn in the Three.js scene.
export function createTextEditor(document, mount = document.body) {
  let field;
  let composing = false;

  function stop() {
    const active = field;
    field = undefined;
    composing = false;
    active?.remove();
  }

  function begin({label, text, caret, maxLength, multiline, onEdit, onFinish}) {
    stop();
    const input = document.createElement(multiline ? 'textarea' : 'input');
    field = input;
    input.tabIndex = -1;
    input.setAttribute('aria-label', label);
    input.autocomplete = 'off';
    input.maxLength = maxLength;
    input.value = text;
    Object.assign(input.style, {
      position: 'fixed', top: '0', left: '0', width: '1px', height: '1px',
      clipPath: 'inset(50%)', fontSize: '16px', padding: '0', border: '0', opacity: '0', pointerEvents: 'none',
    });
    mount.append(input);
    input.setSelectionRange(caret, caret);
    const edit = () => onEdit(input.value, input.selectionEnd);
    const finish = (outcome, event) => {
      if (field !== input) return;
      edit();
      stop();
      onFinish(outcome, event);
    };
    input.addEventListener('input', edit);
    input.addEventListener('select', edit);
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; edit(); });
    input.addEventListener('keyup', edit);
    input.addEventListener('blur', () => finish('blur'));
    input.addEventListener('keydown', event => {
      if (event.defaultPrevented || composing || event.isComposing || event.keyCode === 229) return;
      const submit = event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey);
      const outcome = submit ? 'submit' : event.key === 'Escape' ? 'cancel' : event.key === 'Tab' ? 'tab' : undefined;
      if (!outcome) return;
      event.preventDefault();
      finish(outcome, event);
    });
    input.focus({preventScroll: true});
    if (document.activeElement === input) return true;
    stop();
    return false;
  }

  return {begin, stop, owns: target => Boolean(field && field === target)};
}

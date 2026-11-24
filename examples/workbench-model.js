/**
 * A deterministic application fixture. Projection IDs are presentation-space
 * coordinates. Both attributed application ports address the same resource.
 */
export function createWorkbench() {
  const location = Object.freeze({projectionId: 'workbench', subjectRef: 'study:weaver'});
  let state = {title: 'Weaver study', revision: 0, actor: null};
  const listeners = new Set();

  function connect(actor) {
    function read(subjectRef) {
      if (subjectRef !== location.subjectRef) throw new Error('Unknown subject');
      return {...state};
    }
    return {
      locate: () => location,
      read,
      rename({subjectRef, expectedRevision, title}) {
        const current = read(subjectRef);
        if (expectedRevision !== current.revision) throw new Error('The subject changed');
        if (typeof title !== 'string' || !title.trim() || title.length > 120) {
          throw new Error('Enter a name of 1–120 characters');
        }
        state = {title, revision: current.revision + 1, actor};
        for (const listener of listeners) listener({...state});
        return {...state};
      },
    };
  }

  return {
    human: connect('fixture-human'),
    companion: connect('fixture-companion'),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

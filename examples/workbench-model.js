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

export function workbenchData({title, revision}, response = 'Applied: ' + title) {
  return {title, revision, response};
}

export function workbenchSurface(surfaceId, catalogId, state) {
  return {version: '1.0', createSurface: {
    surfaceId, catalogId, sendDataModel: true,
    dataModel: workbenchData(state, 'Ready to name this view'),
    components: [
      {id: 'root', component: 'Column', children: ['heading', 'title', 'apply', 'response']},
      {id: 'heading', component: 'Text', text: '**Name this view**'},
      {id: 'title', component: 'TextField', label: 'View name', value: {'@path': '/title'}},
      {id: 'apply', component: 'Button', child: 'applyLabel', action: {
        event: {name: 'applyTitle', context: {title: {'@path': '/title'}, revision: {'@path': '/revision'}}},
      }},
      {id: 'applyLabel', component: 'Text', text: 'Apply name'},
      {id: 'response', component: 'Text', text: {'@path': '/response'}, '@accessibility': {live: 'polite'}},
    ],
  }};
}

export const spatialWorkbenchData = state => ({...workbenchData(state), draftTitle: state.title});

export function spatialWorkbenchSurface(surfaceId, catalogId, state) {
  const apply = {event: {name: 'applyTitle', context: {
    title: {'@path': '/draftTitle'}, revision: {'@path': '/revision'},
  }}};
  return {version: '1.0', createSurface: {
    surfaceId, catalogId, dataModel: spatialWorkbenchData(state),
    components: [
      {id: 'root', component: 'HudPanel', label: 'Shared study controls', width: 2.2, gap: 0.035,
        children: ['heading', 'title', 'apply', 'response']},
      {id: 'heading', component: 'HudText', label: 'Weaver study', style: 'title'},
      {id: 'title', component: 'HudTextInput', label: 'View name', value: {'@path': '/title'},
        draft: {'@path': '/draftTitle'}, maxLength: 120, action: apply},
      {id: 'apply', component: 'HudButton', label: 'Apply name', submitFor: 'title', action: apply},
      {id: 'response', component: 'HudText', label: {'@path': '/response'}, lines: 2, style: 'status'},
    ],
  }};
}

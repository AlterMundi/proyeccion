import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export const publicModel = '1'.repeat(32);
export const restrictedModel = '2'.repeat(32);

export async function startHolodeckWorktable(host, stage) {
  const fromHost = name => import(pathToFileURL(join(host, 'src', name + '.mjs')).href);
  const [{createHolodeck}, {houseId}, {RoomStore}] = await Promise.all([
    fromHost('server'), fromHost('houses'), fromHost('room-store'),
  ]);
  const owner = 'dm:being:v1:' + 'p'.repeat(43);
  const guest = 'human:guest';
  const house = houseId(owner);
  const version = 'a'.repeat(64);
  const home = 'https://home.test';
  const stateDir = join(stage, 'worktable-state');
  await mkdir(stateDir);
  new RoomStore(join(stateDir, 'houses')).save({schema: 'holodeck.houses/v1', receipts: [], houses: [{
    id: house, owner, revision: 1, parcel: 'parcel-west-1',
    facade: {color: '#226655', title: 'House', width: 2, depth: 1, height: 2},
  }]});
  const actors = {
    owner: {id: owner, kind: 'daimon', rights: ['observe', 'edit']},
    guest: {id: guest, ref: guest, kind: 'human', rights: ['observe']},
  };
  const actorKey = cookie => /(?:^|;\s*)__Host-home=(owner|guest)(?:;|$)/.exec(cookie)?.[1];
  const holodeck = await createHolodeck({
    basePath: '/native/', stateDir, publicOrigin: home,
    identityResolver: async request => actors[actorKey(request.headers.cookie)] ?? null,
    interiorSpaces: [{id: 'matter', house, title: 'Manipulación de Materia', entry: true, level: 0, guests: [guest], links: []}],
    matterCollection: {room: 'matter', art: 'matter-workshop-v1', projects: [{
      id: 'fixture', resources: [publicModel, restrictedModel],
    }]},
    async collectionSourceRequest(url, {headers}) {
      assert.equal(url.origin, home);
      const visible = actorKey(headers.Cookie) === 'owner' ? [publicModel, restrictedModel] : [publicModel];
      if (url.pathname === '/catalog.json') {
        return Response.json({entries: visible.map(resource => ({
          resource_ref: 'dm:resource:v1:' + resource, kind: 'artifact', model_review: true,
          title: resource === publicModel ? 'Shared model' : 'Restricted model', version_ref: version,
        }))});
      }
      assert.ok(visible.some(resource => url.pathname === '/works/' + resource + '/' + version + '/review-live.json'));
      return Response.json({schema: 'dm.review-live/v1', gallery: 'gallery.json', sha256: '0'.repeat(64)},
        {headers: {'X-Home-Version': version}});
    },
  });
  return {
    close: () => holodeck.close(),
    plugin: {
      name: 'holodeck-worktable-fixture',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (!request.url.startsWith('/native/')) return next();
          // Translate the loopback fixture's origin and identity cookie to the
          // inputs Holodeck normally receives from the HTTPS Home service.
          if (request.headers.origin === 'http://' + request.headers.host) request.headers.origin = home;
          request.headers.cookie = request.headers.cookie?.replace(/(^|;\s*)fixture_actor=(owner|guest)(?=;|$)/,
            '$1__Host-home=$2');
          holodeck.app(request, response);
        });
      },
    },
  };
}

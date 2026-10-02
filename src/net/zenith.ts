// Launched from the Zenith.net launcher: the desktop shell turns the launcher's --zenith-user / --zenith-party /
// --zenith-role switches into ?zuser= / ?zparty= / ?zrole=. The party id lets launcher party members find each
// other in the lobby: the party host invites them and they accept on their own.
const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
const party = q?.get('zparty') ?? '';

export const ZENITH = q?.get('zuser')
  ? {
      user: q.get('zuser')!.slice(0, 20),
      party: /^[\w:-]{8,80}$/.test(party) ? party : null,
      host: q.get('zrole') === 'host',
    }
  : null;

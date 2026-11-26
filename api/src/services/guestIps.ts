// How many different guest ids one network address may bring to the AI features in a
// Toronto day (DECISIONS B43). The site-wide guest cap (caps.ts) counts distinct guest
// ids, and a guest id is just a UUID the browser makes up, so one script sending 100
// requests with 100 fresh ids used to take every guest slot and lock real visitors out
// until midnight. This lets a few people share an address (a household, an office), and
// stops one address from minting guests. Signed-in users are never counted here.
//
// Kept in memory like the rate limiters (B31): one API container serves the site. A
// restart forgets the day's counts, which only ever lets more guests in, never fewer.

// More addresses than this in one day means something is wrong; refusing new ones keeps
// the map from growing without bound (the day's guest cap holds the real line anyway).
const MAX_ADDRESSES = 50_000;

export type GuestIpLimit = {
  // True if this guest may use the AI features from this address today. A guest already
  // admitted from the address is always let back in.
  admit(ip: string, subject: string, day: string): boolean;
};

export function createGuestIpLimit(maxPerDay: number): GuestIpLimit {
  let currentDay = "";
  const guestsByIp = new Map<string, Set<string>>();

  return {
    admit(ip, subject, day) {
      if (maxPerDay === 0) return true; // 0 turns the limit off
      if (day !== currentDay) {
        currentDay = day;
        guestsByIp.clear();
      }
      const seen = guestsByIp.get(ip);
      if (seen?.has(subject)) return true;
      if (seen === undefined && guestsByIp.size >= MAX_ADDRESSES) return false;
      if (seen !== undefined && seen.size >= maxPerDay) return false;
      guestsByIp.set(ip, (seen ?? new Set()).add(subject));
      return true;
    },
  };
}

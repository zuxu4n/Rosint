#!/usr/bin/env node
// Generates a reply to a removal-request email.
//
// Usage:
//   node scripts/removal-reply.mjs <username> [their name]
//
// Examples:
//   node scripts/removal-reply.mjs example_user
//   node scripts/removal-reply.mjs example_user "Sam"

const [, , rawUser, rawName] = process.argv;

if (!rawUser) {
    console.error('Usage: node scripts/removal-reply.mjs <username> [their name]');
    process.exit(1);
}

// Strip a pasted u/ or /u/ prefix so the username is clean.
const user = rawUser.replace(/^\/?u\//i, "").replace(/^@/, "");
const greeting = rawName ? `Hi ${rawName},` : "Hi,";

const email = `Subject: Re: Removal request

${greeting}

Thanks for reaching out. I've removed u/${user} from search on rosint.dev — it
no longer returns any results there. The change goes live on the next deploy,
usually within a few minutes.

One thing worth knowing: rosint.dev doesn't store any Reddit data itself — it
only queries independent open-source archives. Blocking the name stops my site
from looking it up, but the underlying archives are run by other people. If
you'd like the data removed at the source too, you can request that directly
here:

  • Arctic Shift: https://docs.google.com/forms/d/e/1FAIpQLSfzkmE8Bg6K_xii7aRm66ljzvo2tR59lTsdJ99acW4WX786Vw/viewform?usp=sf_link
  • PullPush:     https://removals.pullpush.io/index.php?a=add

If the tool was useful and you'd like to support it, you can buy me a coffee —
totally optional, no pressure: https://ko-fi.com/zuxu4n

Best,
Jason
`;

console.log(email);

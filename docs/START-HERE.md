# Start here: changing the Roastery Ledger with Claude

You have your **own private copy** of the inventory app on this laptop, with made-up sample data.
You can change anything you like by describing it to Claude in plain English.
**You can't break the real app.** Your changes only go anywhere when you send them to Zack, and Zack
checks them first.

## Every time

1. Open the **Claude** app and click **Code** at the top.
2. Make sure it's in the **roastery-ledger** folder (it usually remembers).
3. Type: **`Start the app`**. Your copy opens in the browser.
   Sign in with `admin@example.test` / `dev-password-123` (fake account, this laptop only).

## Things you can say

| You want to… | Say something like… |
|---|---|
| Change something | "On the Stock page, add a column showing the supplier." |
| Fix something annoying | "When I record a roast, the date should default to today." |
| See what changed | "Show me what you changed and where to look." |
| Undo | "Undo that last change." / "Throw away everything since I last sent something to Zack." |
| Send it for review | **"Send this to Zack."** |
| Start something new | "Start a new change: …" |
| Get Zack's latest version | "Get the latest version." |
| Respond to Zack's feedback | "Zack asked for changes on my pull request." |
| Get unstuck | "Something's wrong" and describe what you see, or paste the error. |

## Tips

- **One idea at a time.** Small changes are quicker for Zack to check and get into the real app sooner.
- **Describe what people should be able to do**, not how to build it. "The floor leader needs to see
  which lots are running low" is perfect.
- **Try it yourself** in the browser before sending. Click around and break it if you can.
- **If Claude asks you to allow something**, it's normally safe to click **Allow**. Claude is set up
  so it can't touch the real app or anything secret.
- **Don't type real business data, passwords or customer details** into the app's files or chats.
  The project's code is public.
- If Claude says **"That needs Zack to change"**, it's hit something that's deliberately off-limits.
  Just tell Zack what you wanted.

## What happens after you send something

Zack gets an email, reviews it, and either asks for tweaks or accepts it. Accepted changes go to the
practice copy (staging) first. Then, once Zack approves, they go to the real app everyone uses.

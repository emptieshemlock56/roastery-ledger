# Setting up a helper's Windows laptop

This is **your** checklist (Zack's) for setting up someone who wants to improve the app by talking to
Claude. They don't need to be technical. Sit with them for this. It takes about 45 minutes, most of it
waiting for downloads.

**When you're done:** they open the Claude app, say what they'd like changed, and Claude changes
**their own private copy** on their laptop. When they like it, Claude sends it to you as a pull
request. Nothing reaches staging or the real app unless you merge it, and production also waits for
your approval.

**What they never get:** your Render, Neon or GitHub logins, any secrets, or the ability to merge or
deploy. None of it is needed.

Tick each box as you go. Each step says what you should see. If you don't see it, check
[If something goes wrong](#if-something-goes-wrong) before moving on.

---

## Part 1: Before the day (they do this, ~10 minutes)

- [ ] **A GitHub account.** They sign up at https://github.com/signup with their own email and
      password, then verify the email. Write down their **username** (for example `jsmith-roastery`).
- [ ] **A paid Claude plan.** They sign in at https://claude.ai with their own email and choose
      **Pro** (about $20/month). The free plan does **not** include the coding part of Claude.
- [ ] **Windows is up to date.** Settings → Windows Update → install everything → restart.
- [ ] They know their **Windows password**. The installers may ask for it.

---

## Part 2: Install four programs (~20 minutes)

All four come from the official makers through Windows' built-in installer, **winget**.

- [ ] **Open PowerShell.** Click Start, type `PowerShell`, click **Windows PowerShell**. A blue or black
      window opens with a line ending in `>`. That's where you type.

- [ ] **Paste these one at a time.** Copy a line, right-click inside the PowerShell window to paste,
      press **Enter**, and wait until the `>` line comes back before doing the next one. If it asks
      `Do you agree to all the source agreements terms?`, type `Y` and press Enter. If Windows pops up
      "Do you want to allow this app to make changes?", click **Yes**.

  ```powershell
  winget install --id Git.Git -e
  ```
  ```powershell
  winget install --id OpenJS.NodeJS.LTS -e
  ```
  ```powershell
  winget install --id GitHub.cli -e
  ```

  You should see `Successfully installed` after each one. If it says `already installed`, that's fine
  too.

- [ ] **Install the Claude app.** In the web browser, go to https://claude.com/download, download the
      **Windows** version, run it and click through. Sign in with **their** Claude account.

- [ ] **Restart the laptop.** This step matters: Windows only notices the new programs after a restart.

- [ ] **Check that everything installed.** Open PowerShell again and paste:

  ```powershell
  git --version; node --version; gh --version
  ```

  You should see three version lines, something like `git version 2.5x…`, `v24.x.x`, `gh version 2.x`.
  Node must start with `v22` or higher.

---

## Part 3: Connect GitHub and get the project (~5 minutes)

- [ ] **Sign this laptop in to their GitHub.** In PowerShell:

  ```powershell
  gh auth login
  ```

  Answer the questions with the arrow keys and Enter:
  1. *Where do you use GitHub?* → **GitHub.com**
  2. *Preferred protocol for Git operations?* → **HTTPS**
  3. *Authenticate Git with your GitHub credentials?* → **Yes**
  4. *How would you like to authenticate?* → **Login with a web browser**
  5. It shows an 8-character code. Press Enter, and the browser opens. **They** sign in to GitHub,
     paste the code, and click **Authorize**.

  You should see `✓ Logged in as <their username>`.

- [ ] **Put their name on their changes.** Replace the parts in quotes with their real name and email:

  ```powershell
  git config --global user.name "Their Name"
  ```
  ```powershell
  git config --global user.email "their-email@example.com"
  ```

- [ ] **Make their own copy of the project and download it.** Paste both lines, one at a time:

  ```powershell
  cd $HOME\Documents
  ```
  ```powershell
  gh repo fork emptieshemlock56/roastery-ledger --clone
  ```

  You should see `Created fork <their username>/roastery-ledger` and `Cloned fork`. The project is now
  in **Documents\roastery-ledger** on their laptop.

You can close PowerShell now. They won't need it again.

---

## Part 4: Start Claude in the project (~10 minutes)

- [ ] **Open the Claude app** and switch to the **Code** tab at the top.
- [ ] **Choose the project folder.** When it asks which folder to work in, pick
      **Documents → roastery-ledger**. If Windows asks whether to trust the folder, say yes.
- [ ] **Type exactly:** `Set me up`

  Claude reads the project's instructions (`CLAUDE.md`) and then, on its own:
  - checks that the programs and the GitHub sign-in work,
  - switches on the **safety settings** for this laptop (it can't touch the pipeline, secrets, or
    anything of yours),
  - installs the app's parts (a few minutes),
  - starts the app and opens it in the browser at http://localhost:5173.

  If Claude asks permission to run something during setup, click **Allow**. If **Windows Firewall**
  asks about Node.js, click **Allow**. It's only the app talking to itself on the laptop.

- [ ] When Claude says to **start a new chat** (for the safety settings), do it, then type
      `Start the app`.
- [ ] **Sign in to their local copy** with `admin@example.test` / `dev-password-123`. It's fake
      sample data that exists only on this laptop.

---

## Part 5: A test run together (~5 minutes)

- [ ] Have them type something small, such as:
      *"On the Stock page, make the heading say 'Stock on hand'."*
- [ ] Claude changes it, runs the checks, and tells them where to look. They refresh the browser and
      see it.
- [ ] Have them type: **`Send this to Zack`**. Claude sends it and gives them a link. That's a
      **pull request** on your repo.
- [ ] Hand them the one-page guide: **`docs/START-HERE.md`**. Print it, or open it on GitHub.

---

## Part 6: Your side, every time they send something

1. **You'll get a GitHub email** about a new pull request. Open it.
2. **The first time only:** GitHub won't run the tests on a newcomer's pull request until you click
   **Approve and run workflows** near the bottom of the page. Click it.
3. **Get it explained.** Open the Claude app in **your** copy of the project and ask:
   *"Review pull request #N and explain in plain English what it changes and anything risky."*
   Be extra careful with anything it flags in `.github/`, `server/migrations/` (database changes) or
   sign-in code.
4. **If the page says the branch is out of date**, click **Update branch** and wait for the tests again.
5. **Merge it** the usual way (with the bypass box). Staging updates by itself in a few minutes.
6. **Try it on staging.** If it's good, approve **production** in GitHub → Actions → the Deploy run →
   **Review deployments**. A backup is taken automatically before production changes.
7. **Not happy?** Leave a comment on the pull request saying what to change. They paste it to Claude,
   or just say "Zack asked for changes on my pull request". Or close the pull request. Nothing is
   lost on their side.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `winget` is not recognized | Install **App Installer** from the Microsoft Store, restart, try again. |
| `git`, `node` or `gh` is not recognized after installing | Restart the laptop. Still wrong? Run that program's `winget install` line again. |
| `node --version` shows v20 or lower | `winget upgrade --id OpenJS.NodeJS.LTS -e`, then restart. |
| `gh auth login` browser step fails | Run `gh auth login` again. Make sure **they** sign in, not you. |
| `gh repo fork` says the fork already exists | Fine. Run `gh repo clone <their-username>/roastery-ledger` instead. |
| Claude says it can't find Git Bash | Restart the laptop. If it still says that, reinstall Git with the first winget line. |
| Claude can't commit: "Please tell me who you are" | Redo the two `git config` lines in Part 3. |
| The app page won't load | Tell Claude: "The app isn't loading, please restart it." |
| Anything else | Tell Claude exactly what you see. It knows this project and can usually fix it. |

## Taking access away later

Nothing of yours to revoke: they only have their own copy. If you've given them a **staging** login,
deactivate it in staging → Users. Close any open pull requests you don't want.

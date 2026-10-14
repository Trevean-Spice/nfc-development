# The React Native workspace

**Document date:** Saturday 22 August 2026
**Recommendation:** remove `src/mobile` from the `workspaces` array and from the root
`tsconfig.json`. **Keep every file in version control.**
**Status: NEEDS DAN'S AGREEMENT for half of it.** The half that does not is already in PR 4.
**PR:** 11 for the part that needs him.

---

## 1. What is being proposed, precisely

Two lines, in two files.

```diff
   "workspaces": [
     "src/api",
-    "src/web",
-    "src/mobile"
+    "src/web"
   ],
```

and the deletion of the interim `.npmrc`, followed by regenerating `package-lock.json`
without `--legacy-peer-deps`.

**Not proposed, and worth saying before anything else so that the ask is not misread:** we
are not deleting the mobile app, not removing it from git, not archiving it, not fixing it,
not adding the missing native projects, and not bringing it to a running state. Every file
stays exactly where it is, at the same path, in the same repository, in the same history.
`git log`, `git blame` and a future `git checkout` all behave identically. The only thing
that changes is that `npm install` stops installing it and `tsc` stops compiling it.

**It is reversible in one line**, by anybody, at any time, with no data loss and no
migration.

---

## 2. Why, in the order the costs are actually paid

**The scope position first, because it frames the rest.** The Scope document, section "Out
of scope, deferred not dropped", first item: the native React Native app is deferred, "Do
not build it". It is not ours to build, maintain or fix, and it must not consume M2 or M3
time. Nothing below is a recommendation to repair it. It is recorded so that the decision
about what to do with it is made on evidence rather than on an assumption that a working
mobile app was inherited.

**It does not build, and the reasons are structural rather than fixable in an afternoon.**
Verified by reading the tree and the manifests:

- **No native projects.** No `android/`, no `ios/`, while `src/mobile/package.json`
  declares build scripts against both. Without the `NFCReaderUsageDescription` entitlement,
  iOS NFC does not function at all.
- **No entry point.** `"main": "index.js"` and there is no `index.js`, no
  `metro.config.js`, no `babel.config.js`, no `app.json`. React Native cannot start.
- **An import of a package it does not declare.** `App.tsx:3` imports
  `@react-navigation/native-stack`; the manifest declares `@react-navigation/stack`, a
  different package.
- **A call to a method the pinned library does not have.** `NFCService.ts:46` calls
  `NfcManager.stop()`, which does not exist on `react-native-nfc-manager@3.17.2`.

**Three costs, paid by everyone every day, in descending order of how much they hurt.**

1. **It breaks the typecheck for the whole repository.** `@types/react-native@0.73.0`, a
   deprecated stub devDependency of this workspace, hoists into the root `node_modules` and,
   combined with the root `typeRoots` setting, produces `TS2688` before a single source file
   is examined. tsc stops there. **A developer running the project typecheck sees one
   unrelated error and no others, which reads as "almost clean"** while 326 errors sit
   behind it, 78 of them from this directory.
2. **It blocks `npm install` on a clean checkout.** `ERESOLVE`, exit 1, verified twice
   during the audit: `@react-native-community/async-storage@1.12.1` declares a peer of
   `react@^16.8` against `react@18.3.1`. Because workspaces install together, a conflict in
   a workspace nobody builds stops the web app and the API installing at all. The workaround
   is `--legacy-peer-deps` and it is documented nowhere.
3. **552 MB.** A root `npm install` pulls the entire React Native toolchain, dominated by
   `react-native` 0.73. Every developer and every CI run pays it in install time and disk,
   for a workspace nobody is meant to be building.

---

## 3. The split that lets most of this land without asking

The three costs are not one change, and separating them is what keeps the ask small.

| Cost | Removed by | Needs Dan | When |
|---|---|---|---|
| Broken typecheck, 78 errors | Excluding `src/mobile` from the root `tsconfig.json` | **No** | **PR 4, already in the plan** |
| `ERESOLVE` on clean install | Removing it from `workspaces` | **Yes** | PR 11 |
| 552 MB per install | Removing it from `workspaces` | **Yes** | PR 11 |

**Excluding a directory from a typecheck says nothing about whether it is in version
control**, so it needs no permission, and it is the cost that hurts most because it is the
one that hides other people's errors. That half lands on Monday.

What is left for PR 11 is install time, disk and a peer conflict. Real, paid daily, worth
asking for, and nobody is blocked by them. That is why PR 11 sits at the end of the merge
chain rather than in the middle: it costs nothing to wait for an answer.

---

## 4. What is not lost, item by item

Written out because "we are removing it from the workspaces array" sounds larger than it is,
and the natural worry is that something is being quietly discarded.

| Worry | Answer |
|---|---|
| Are the files deleted? | No. Every file stays at its current path, tracked, with its history |
| Can it be built later? | Exactly as well as it can be built today, which is not at all: it has no native projects and no entry point. Removing it from `workspaces` does not move that in either direction |
| Does it break the documented seam? | No. The Scope document promises the seam between web and native is documented. That document is unaffected by an npm configuration key |
| If a later phase revives it? | Add the line back, run `npm install`. The work that phase actually faces is unchanged: the NFC read path and the URL parser both have to be rewritten against Type 5 and `/t/{code}` regardless, because `NFCService.ts:193` looks for a path segment called `blend` and a real tag carries `/t/ps`. Held against a genuine Trevean jar, this app reports the tag as unreadable |
| Does it affect the licence obligation? | No. `src/mobile/package.json` dependencies remain listed in the background-IP manifest whether or not they are installed |

---

## 5. What to ask Dan, and how

One short message, plain text, no markdown, alongside the two document header asks. Suggested
wording:

> Three small changes to the repository that need your yes.
>
> The second one: the React Native app in src/mobile is listed as an npm workspace, which
> means every install pulls the whole React Native toolchain, 552 MB, and a clean install
> currently fails outright because that app depends on a package that wants React 16 while
> everything else is on React 18. The app itself cannot run: it has no iOS or Android
> project and no entry point, so this is not a working app we would be turning off.
>
> We would like to take it out of the workspaces list. Every file stays in the repository
> exactly where it is, with its history. Nothing is deleted and it is one line to put back.
> It is out of scope under the SOW either way, so this is about install time for everyone
> else rather than about the app.
>
> If you would rather leave it, that is fine and we will work around it. It costs a few
> minutes per install and a bigger checkout, not a decision.

**The last line is deliberate.** This is a convenience change, not a safety one, and it
should not be pressed as though it were. The safety ask in the same message is the
`NFC-SPECS.md` header, and mixing the two registers would blunt that one.

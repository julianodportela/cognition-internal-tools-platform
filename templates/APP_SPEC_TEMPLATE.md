# <App name>

> Written in plain language for the person who asked for the app. They confirm this
> document, not the code. Keep every line something a non-engineer can verify.

## Purpose
One or two sentences: who has the problem, what the app lets them do.

## Who uses it
- **<role>** — can: view / create / …  (roles: analyst, senior_reviewer,
  compliance_readonly, support_agent, finance_approver, eng_dev, eng_admin)
- Who can see other people's items? (only their own / their team / everyone)

## Data
One line per thing we store. Mark anything personal or financial as **sensitive** —
it is hidden by default and can only be revealed by people with that permission,
and every reveal is recorded.
- <item>: field, field, **sensitive field**, …

## Screens
- **<Screen>** (`/a/<id>/<path>`): what is listed, filters, buttons.

## Actions
One line per button. Say who may press it and when it needs someone else's sign-off.
- **<Action>** — what it does. Who: <role>. Needs approval when: <condition | always | never>.
  (Anything that moves money or contacts an outside system always needs approval.)

## Stages (if items move through a process)
draft -> submitted -> approved -> … Who can move it to each stage.

## Data mode
**Sandbox.** All data is made up. Nothing here touches real customers.
Switching to real data is a separate engineering approval step.

## Out of scope
What this app deliberately does not do.

## Open questions
Anything unclear. The app is not built until these are answered.

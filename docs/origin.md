# Why Annotate.js exists

In the first week of June 2026, I was working on a citizen proposal for child rights legislation in Sri Lanka. It was intended as a proactive response to a series of child rights violations that had occurred in the name of religious freedom. It was an attempt to do something meaningful rather than simply ranting on social media or attending protests.

After a few days of drafting, with the help of three AI tools (`NotebookLM`, `Claude`, and `ChatGPT`), extensive cross-checking / fact-checking, and a good amount of manual editing also, I decided to publish it as a static HTML page.

[Child Rights Harmonisation Bill 2026](https://lankavoice.github.io/proposals/Child_Rights_Harmonisation_Bill_2026.html)

Though I talked a few friends regarding the effort, none of us had any formal legal background in drafting a proposal for constitutional amendment. I was well aware that proposing and campaigning for constitutional reform is not something that can be achieved simply by publishing a document on the internet.

So, we wanted to gather support, attract attention to the proposal, and invite contributions from people with relevant expertise. For that reason, it was important that the document be reviewed by activists, legal professionals, subject-matter experts, and citizens who could provide feedback, validate specific clauses, identify potential issues, and improve the proposal overall before moving to the next step.

The problem was clear: how do you collect meaningful feedback on a static HTML page?

The obvious solution was to move the document to `Google Docs`. However, I had been deliberately de-Googling myself, moving away from big-tech platforms toward privacy-respecting alternatives over the past years. In addition to that, publishing a public-interest document inside Google’s infrastructure simply did not feel right.

So I looked at what already existed. Apparently, [Annotator.js](https://github.com/openannotation/annotator) been the standard for inline web annotation for many years, and [Hypothesis](https://hypothes.is) is probably the best-known platform built on top of it. Both are capable tools, but neither was the right fit for this use case. At least, I couldn't find anything. Every tool I found either backend-heavy, require significant infrastructure to self-host, or built on legacy technologies. There was nothing simple enough to drop into an existing HTML page with a single script tag and have a working review system without a significant amount of hassle and effort.

The gap was obvious.

So I decided to build something from scratch using Claude Code, rather rely on something not exactly address the problem. At the same time, I wanted to aim a little higher because I believed the problem was not limited to this particular use case. It remains a major obstacle for people trying to move away from platforms like Google Docs while still maintaining effective collaboration and review workflows.

So, that’s the origin.

I hope what started as a solution for a single citizen proposal grows into something great.

[Annotate.js](https://github.com/kasunben/Annotate.js) is built around the same values that created the original problem: keep your data where you choose, don’t depend on third-party platforms, and don’t let infrastructure prevent small groups from doing serious work.

May it be useful.

kasunben · June 6, 2026

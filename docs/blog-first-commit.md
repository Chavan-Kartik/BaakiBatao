# BaakiBatao — tell me the rest

> Your insurer paid less than you claimed. Was that lawful?

That question became **BaakiBatao**, built by **Kartik Chavan**, **Eshan Nahar** and
**Avadhut Noola** for **First Commit, Bharat Builds × AWS**.

---

## The problem is explanation, not rejection

Policies have room rent limits, deductibles, co-payments, sub-limits and non-payable items.
A lower settlement is not proof of wrongdoing.

So we did not build a tool that labels deductions suspicious. We built one that **reconstructs
the settlement independently and then compares**.

Every deduction lands in one of three buckets:

| Bucket | What it means |
|---|---|
| **Correctly applied** | We can reproduce it from the policy |
| **Incorrectly applied** | It conflicts with a clause we can cite |
| **Unresolved** | We do not have enough to make a defensible call |

That last one matters. If the documents do not explain something, we say so.

---

## Reconstruction, not detection

Deductions happen in sequence. A room rent cap affects related charges. A deductible changes
the payable base. Co-pay applies to that result.

In our worked example the total deduction is **₹2,06,680**:

| | Amount | Why |
|---|---:|---|
| Correctly applied | ₹84,480 | Reproduced from the policy |
| Incorrectly applied | ₹1,19,200 | Conflicts with rules we can cite |
| Unresolved | ₹3,000 | Unexplained |
| **Total** | **₹2,06,680** | |

But the answer is not "ask for ₹1,19,200 back." Restore those deductions and the policy's
**10 percent co-pay** still applies:

```
₹1,19,200  disputed, with a clause behind every rupee
−  ₹11,920  the 10% co-pay that lawfully rides on a restored deduction
────────────
₹1,07,280  actually challengeable, with citations
```

That gap is the entire argument for running the full calculation.

---

## The arithmetic has to close

If the difference is ₹2,06,680, our findings sum to ₹2,06,680. **Exactly.**

- Money is stored in **integer paise**, never floats.
- Every finding carries a clause behind it, or it is not a finding.

The engine runs **seven ordered stages**:

1. Admissibility
2. Bill line normalisation
3. Non-payable rules
4. Caps and sub-limits
5. Proportionate deductions
6. Deductible and co-pay
7. Sum insured

Order matters, so it lives in a **versioned rulepack as data** rather than scattered through
application code. Same input, same rulepack, same output.

---

## Where AWS fits

| Service | What it does here |
|---|---|
| **Amazon S3** | Documents land through presigned uploads |
| **Amazon Textract** | Extracts structure from bills, deduction sheets and policies |
| **AWS Step Functions** | Orchestrates the workflow, including stages that pause for human correction |
| **AWS Lambda** | Runs each stage |
| **Amazon DynamoDB** | Holds case state and events |
| **AWS KMS** | Signs the final certificate |
| **Amazon Comprehend** | The redaction gate, plus deterministic checks |
| **Amazon Bedrock** | Turns already redacted findings into readable prose |

Before text moves downstream it passes the redaction gate, keeping raw documents separated
from later stages.

> **Bedrock sits in the pipeline but never decides the money.** The number comes from rules
> and arithmetic.

---

## Failing honestly

OCR is noisy and bill descriptions vary. If a line cannot be normalised confidently, the
workflow **stops and asks** instead of attaching the wrong rule to the wrong charge.

We also tested that lawful deductions are left alone. A system that flags everything demos
well and helps nobody.

The standard we kept returning to was never *"can we detect a bad deduction."* It was:

> **Can someone else verify why we reached this result?**

---

**BaakiBatao. Tell me the rest.**

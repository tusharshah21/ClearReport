# Guideline thresholds used by the range check

Status: **pending review by a doctor.** Every threshold below was checked against the source text on 2026-11-22. None has been clinically reviewed. The code is in `src/guidelines.ts`; the exact source strings are in `SOURCES` there.

ClearReport explains your report. It does not give medical advice. Always discuss results with your doctor.

## Sources and where each was read

| Source | Edition | Read at |
| --- | --- | --- |
| ADA Standards of Care in Diabetes, Section 2: Diagnosis and Classification of Diabetes | 2026, Diabetes Care 2026;49(Suppl. 1):S27-S49, doi:10.2337/dc26-S002 | PubMed Central PMC12690183 (Tables 2.1 and 2.2). diabetesjournals.org blocked automated access. |
| NCEP Adult Treatment Panel III Final Report | Circulation 2002;106(25):3143-3421, PMID 12485966 | Citation from PubMed. Thresholds from the NHLBI "ATP III At-A-Glance: Quick Desk Reference" (archived copy, web.archive.org, captured 2016-01-09). ahajournals.org blocked automated access. |
| WHO Guideline on haemoglobin cutoffs to define anaemia in individuals and populations | Geneva: WHO, 2024, ISBN 978-92-4-008854-2 | NCBI Bookshelf NBK602198, Executive summary, Table 2 |
| Lipid Association of India Expert Consensus Statement on Management of Dyslipidemia in Indians 2020 | J Assoc Physicians India 2020;68(11 Special), Part III PMID 33350610 | Citation from PubMed only. Used in the lipid note, not for any threshold. |

## Thresholds

| Test | Bands used | Source text | Match |
| --- | --- | --- | --- |
| Fasting glucose | below 100; 100-125 (prediabetes criterion); 126 or higher (diabetes criterion), mg/dL | Table 2.2: FPG 100 to 125 mg/dL (IFG). Table 2.1: FPG ≥126 mg/dL | yes |
| HbA1c | below 5.7; 5.7-6.4 (prediabetes criterion); 6.5 or higher (diabetes criterion), % | Table 2.2: A1C 5.7-6.4%. Table 2.1: A1C ≥6.5% | yes |
| Total cholesterol | below 200 desirable; 200-239 borderline high; 240 or higher high, mg/dL | Same | yes |
| LDL cholesterol | below 100 optimal; 100-129 near or above optimal (not flagged, product decision); 130-159 borderline high; 160-189 high; 190 or higher very high, mg/dL | Same | yes |
| HDL cholesterol | below 40 low, for everyone (product decision) | "<40 Low" | yes |
| Triglycerides | below 150 normal; 150-199 borderline high; 200-499 high; 500 or higher very high, mg/dL | Same | yes |
| Hemoglobin | women below 12.0, men below 13.0 g/dL, non-pregnant, ages 15 to 65 | Table 2: adults 15-65 years, non-pregnant women <120 g/L, men <130 g/L | yes, age span corrected |

## Changes made after checking

- WHO: the adult cutoffs cover ages **15 to 65**, not "15 and over". The check now runs only when the whole age band is inside that span (20-29 to 50-59). Bands 10-19, 60-69 and older get "only your lab's range applies".
- ADA: the source now names the full page range (S27-S49), the DOI and the two tables. Its footnote says that without unequivocal hyperglycemia a diagnosis needs two abnormal results, which matches the "usually confirmed with a repeat test" wording.
- ATP III and WHO: source strings now name the exact table and edition.

## Far-out-of-range banner

Status: **pending review by a doctor.** Plain code (`farOutOfRange` in `src/guidelines.ts`), not AI, and not taken from any guideline: it is a product rule.

It applies only to **hemoglobin, platelets and WBC** (total white cell count). A value counts as far outside the lab's printed range when it is:

- below half of the lab's lower limit (value < 0.5 × lower limit), or
- above twice the lab's upper limit (value > 2 × upper limit).

Lipids, glucose and HbA1c never trigger the banner: their guideline messages already describe how a result compares with the guideline bands.

Only values with a printed limit count, and only values the user has confirmed (rows still waiting for "Please check" are left out). If any value qualifies, the explanation screen shows one static banner: "Some results are well outside your lab's range. Please share this report with your doctor soon." It never names a condition or says how urgent.

## Wording rules

- ADA bands are described as "one of the criteria doctors consider for diabetes (or prediabetes), usually confirmed with a repeat test". The phrase "diabetes range" is never used (checked in `scripts/checks.ts`).
- Every lipid message ends with: "Indian guidelines (Lipid Association of India, 2020) set targets based on overall heart risk, so your doctor may use different goals."
- Every hemoglobin message ends with: "Different ranges apply during pregnancy."

## Not included

WBC, platelets and TSH: no single named guideline threshold could be attributed. See `NOT_INCLUDED` in `src/guidelines.ts`.

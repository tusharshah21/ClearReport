# Extraction spike results

Generated 2026-11-23T04:40:21.321Z by `npm run eval` from `test-data/runs/`. Accuracy columns are over all ground-truth tests (a test not found counts as wrong). PII missed = identity fields not extracted correctly; each one is a field the stripping step would not know to remove.

## Summary

| mode / set | successful runs | tests found | value | unit | range | flag | PII missed | median latency ms | median out chars |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cloud clean | 6/6 | 100% | 100% | 100% | 100% | 100% | 0/36 | 6939 | 2398 |
| cloud pdf | 2/2 | 100% | 85% | 98% | 95% | 100% | 0/7 | 19905 | 12707 |
| cloud photo | 2/2 | 100% | 100% | 100% | 100% | 100% | 0/12 | 10318 | 5017 |
| device clean | 6/6 | 98% | 91% | 95% | 58% | 89% | 7/36 | 106527 | 1756 |
| device pdf | 2/2 | 98% | 95% | 98% | 98% | 98% | 0/7 | 3 | 0 |
| device photo | 2/2 | 91% | 66% | 44% | 19% | 44% | 6/12 | 138253 | 3068 |

## Per report

| report | layout | mode | attempts | served by | tests found | value | unit | range | flag | PII missed | latency ms | out chars |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WM14 | LPL-pdf | device | rows(0 calls):ok |  | 32/33 | 94% | 97% | 97% | 97% | none | 3 | 0 |
| WM14 | LPL-pdf | cloud | pages(single,single,single,single):ok | in_cloud | 33/33 | 97% | 94% | 91% | 100% | none | 15712 | 6807 |
| WM15 | LPL-pdf | device | rows(0 calls):ok |  | 54/55 | 96% | 98% | 98% | 98% | none | 2 | 0 |
| WM15 | LPL-pdf | cloud | pages(single,single,single,single,single):ok | in_cloud | 55/55 | 78% | 100% | 98% | 100% | none | 19905 | 12707 |
| r1-photo | A | device | single:ok | on_device | 10/10 | 100% | 30% | 10% | 50% | doctor_name | 81144 | 1703 |
| r1-photo | A | cloud | single:ok | in_cloud | 10/10 | 100% | 100% | 100% | 100% | none | 10318 | 2368 |
| r1 | A | device | single:ok | on_device | 10/10 | 100% | 100% | 60% | 90% | none | 118070 | 1756 |
| r1 | A | cloud | single:ok | in_cloud | 10/10 | 100% | 100% | 100% | 100% | none | 7510 | 2398 |
| r2 | B | device | single:ok | on_device | 7/7 | 100% | 100% | 71% | 100% | patient_name, patient_id, phone | 62884 | 1299 |
| r2 | B | cloud | single:ok | in_cloud | 7/7 | 100% | 100% | 100% | 100% | none | 7363 | 1758 |
| r3 | C | device | single:ok | on_device | 3/3 | 100% | 100% | 67% | 67% | none | 70141 | 944 |
| r3 | C | cloud | single:ok | in_cloud | 3/3 | 100% | 100% | 100% | 100% | none | 2488 | 936 |
| r4 | A | device | single:ok | on_device | 3/3 | 100% | 100% | 67% | 100% | none | 63485 | 926 |
| r4 | A | cloud | single:ok | in_cloud | 3/3 | 100% | 100% | 100% | 100% | none | 2440 | 920 |
| r5 | B | device | single:ok | on_device | 12/12 | 92% | 100% | 92% | 100% | sex | 106527 | 2065 |
| r5 | B | cloud | single:ok | in_cloud | 12/12 | 100% | 100% | 100% | 100% | none | 6939 | 2841 |
| r6-photo | C | device | single:ok | on_device | 19/22 | 50% | 50% | 23% | 41% | patient_name, age, patient_id, phone, doctor_name | 138253 | 3068 |
| r6-photo | C | cloud | single:ok | in_cloud | 22/22 | 100% | 100% | 100% | 100% | none | 7728 | 5017 |
| r6 | C | device | single:ok | on_device | 21/22 (+4 extra) | 82% | 86% | 32% | 82% | sex, patient_id, phone | 188155 | 4103 |
| r6 | C | cloud | single:ok | in_cloud | 22/22 | 100% | 100% | 100% | 100% | none | 5250 | 5017 |

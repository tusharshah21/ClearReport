# Extraction spike results

Generated 2026-11-22T08:58:01.904Z by `npm run eval` from `test-data/runs/`. Accuracy columns are over all ground-truth tests (a test not found counts as wrong). PII missed = identity fields not extracted correctly; each one is a field the stripping step would not know to remove.

## Summary

| mode / set | successful runs | tests found | value | unit | range | flag | PII missed | median latency ms | median out chars |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cloud clean | 6/6 | 100% | 100% | 100% | 100% | 100% | 0/36 | 4484 | 2168 |
| cloud photo | 2/2 | 100% | 100% | 100% | 100% | 100% | 1/12 | 7817 | 4511 |
| device clean | 0/0 | n/a | n/a | n/a | n/a | n/a | 0/0 | 0 | 0 |
| device photo | 0/0 | n/a | n/a | n/a | n/a | n/a | 0/0 | 0 | 0 |

## Per report

| report | layout | mode | attempts | served by | tests found | value | unit | range | flag | PII missed | latency ms | out chars |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r1-photo | A | device | no run |  |  |  |  |  |  |  |  |  |
| r1-photo | A | cloud | single:ok | in_cloud | 10/10 | 100% | 100% | 100% | 100% | none | 7817 | 2168 |
| r1 | A | device | no run |  |  |  |  |  |  |  |  |  |
| r1 | A | cloud | single:ok | in_cloud | 10/10 | 100% | 100% | 100% | 100% | none | 8928 | 2168 |
| r2 | B | device | no run |  |  |  |  |  |  |  |  |  |
| r2 | B | cloud | single:ok | in_cloud | 7/7 | 100% | 100% | 100% | 100% | none | 3379 | 1597 |
| r3 | C | device | no run |  |  |  |  |  |  |  |  |  |
| r3 | C | cloud | single:ok | in_cloud | 3/3 | 100% | 100% | 100% | 100% | none | 2914 | 867 |
| r4 | A | device | no run |  |  |  |  |  |  |  |  |  |
| r4 | A | cloud | single:ok | in_cloud | 3/3 | 100% | 100% | 100% | 100% | none | 3764 | 852 |
| r5 | B | device | no run |  |  |  |  |  |  |  |  |  |
| r5 | B | cloud | single:ok | in_cloud | 12/12 | 100% | 100% | 100% | 100% | none | 4484 | 2565 |
| r6-photo | C | device | no run |  |  |  |  |  |  |  |  |  |
| r6-photo | C | cloud | single:ok | in_cloud | 22/22 | 100% | 100% | 100% | 100% | patient_id | 5834 | 4511 |
| r6 | C | device | no run |  |  |  |  |  |  |  |  |  |
| r6 | C | cloud | single:ok | in_cloud | 22/22 | 100% | 100% | 100% | 100% | none | 6719 | 4511 |

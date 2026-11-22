# Extraction spike results

Generated 2026-11-22T11:47:48.304Z by `npm run eval` from `test-data/runs/`. Accuracy columns are over all ground-truth tests (a test not found counts as wrong). PII missed = identity fields not extracted correctly; each one is a field the stripping step would not know to remove.

## Summary

| mode / set | successful runs | tests found | value | unit | range | flag | PII missed | median latency ms | median out chars |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cloud clean | 6/6 | 100% | 100% | 100% | 100% | 100% | 0/36 | 6939 | 2398 |
| cloud pdf | 2/2 | 100% | 85% | 98% | 95% | 100% | 0/7 | 19905 | 12707 |
| cloud photo | 2/2 | 100% | 100% | 100% | 100% | 100% | 0/12 | 10318 | 5017 |
| device clean | 0/0 | n/a | n/a | n/a | n/a | n/a | 0/0 | 0 | 0 |
| device pdf | 0/0 | n/a | n/a | n/a | n/a | n/a | 0/0 | 0 | 0 |
| device photo | 0/0 | n/a | n/a | n/a | n/a | n/a | 0/0 | 0 | 0 |

## Per report

| report | layout | mode | attempts | served by | tests found | value | unit | range | flag | PII missed | latency ms | out chars |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WM14 | LPL-pdf | device | no run |  |  |  |  |  |  |  |  |  |
| WM14 | LPL-pdf | cloud | pages(single,single,single,single):ok | in_cloud | 33/33 | 97% | 94% | 91% | 100% | none | 15712 | 6807 |
| WM15 | LPL-pdf | device | no run |  |  |  |  |  |  |  |  |  |
| WM15 | LPL-pdf | cloud | pages(single,single,single,single,single):ok | in_cloud | 55/55 | 78% | 100% | 98% | 100% | none | 19905 | 12707 |
| r1-photo | A | device | no run |  |  |  |  |  |  |  |  |  |
| r1-photo | A | cloud | single:ok | in_cloud | 10/10 | 100% | 100% | 100% | 100% | none | 10318 | 2368 |
| r1 | A | device | no run |  |  |  |  |  |  |  |  |  |
| r1 | A | cloud | single:ok | in_cloud | 10/10 | 100% | 100% | 100% | 100% | none | 7510 | 2398 |
| r2 | B | device | no run |  |  |  |  |  |  |  |  |  |
| r2 | B | cloud | single:ok | in_cloud | 7/7 | 100% | 100% | 100% | 100% | none | 7363 | 1758 |
| r3 | C | device | no run |  |  |  |  |  |  |  |  |  |
| r3 | C | cloud | single:ok | in_cloud | 3/3 | 100% | 100% | 100% | 100% | none | 2488 | 936 |
| r4 | A | device | no run |  |  |  |  |  |  |  |  |  |
| r4 | A | cloud | single:ok | in_cloud | 3/3 | 100% | 100% | 100% | 100% | none | 2440 | 920 |
| r5 | B | device | no run |  |  |  |  |  |  |  |  |  |
| r5 | B | cloud | single:ok | in_cloud | 12/12 | 100% | 100% | 100% | 100% | none | 6939 | 2841 |
| r6-photo | C | device | no run |  |  |  |  |  |  |  |  |  |
| r6-photo | C | cloud | single:ok | in_cloud | 22/22 | 100% | 100% | 100% | 100% | none | 7728 | 5017 |
| r6 | C | device | no run |  |  |  |  |  |  |  |  |  |
| r6 | C | cloud | single:ok | in_cloud | 22/22 | 100% | 100% | 100% | 100% | none | 5250 | 5017 |

Median per scenario for `snapshot-modes`. Est. tokens = chars / 4.

| scenario | runs | calls | calls per tool | chars | est. tokens | screenshots | errors | cost USD | peak context | passed |
|---|---|---|---|---|---|---|---|---|---|---|
| covered | 3 | 7 | click 3, navigate 1, snapshot 3 | 3854 | 963 | 0 | 0 | 0.0085 | 47905 | 3/3 |
| delayed | 3 | 5 | click 1, navigate 1, snapshot 3 | 2305 | 576 | 0 | 0 | 0.0078 | 47312 | 3/3 |
| form | 3 | 35 | click 8, console 1, navigate 3, screenshot 2, snapshot 6, type 12 | 17408 | 4352 | 2 | 0 | 0.0147 | 58655 | 3/3 |
| github | 3 | 9 | click 3, navigate 1, screenshot 0, snapshot 5, type 0 | 52394 | 13098 | 0 | 0 | 0.011 | 64571 | – |
| infinite | 3 | 34 | click 1, console 1, navigate 14, screenshot 7, snapshot 5, type 0 | 12369 | 3092 | 7 | 1 | 0.02 | 70093 | 2/3 |
| long | 3 | 4 | click 1, console 0, navigate 1, screenshot 0, snapshot 2 | 3858 | 964 | 0 | 0 | 0.0077 | 47788 | 3/3 |
| modal | 3 | 13 | click 3, console 0, navigate 1, screenshot 0, snapshot 5, type 3 | 21638 | 5409 | 0 | 0 | 0.0102 | 55160 | 3/3 |
| wikipedia | 3 | 3 | click 0, navigate 1, snapshot 2 | 29989 | 7497 | 0 | 0 | 0.0156 | 56569 | 3/3 |

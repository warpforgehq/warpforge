Median per scenario for `baseline`. Est. tokens = chars / 4.

| scenario | runs | calls | calls per tool | chars | est. tokens | screenshots | errors | cost USD | peak context | passed |
|---|---|---|---|---|---|---|---|---|---|---|
| covered | 3 | 7 | click 3, navigate 1, snapshot 3 | 3804 | 951 | 0 | 0 | 0.008 | 47611 | 3/3 |
| delayed | 3 | 5 | click 1, navigate 1, snapshot 3 | 2331 | 582 | 0 | 0 | 0.0077 | 47129 | 3/3 |
| form | 3 | 15 | click 4, console 0, navigate 1, screenshot 1, snapshot 3, type 6 | 8169 | 2042 | 1 | 0 | 0.0102 | 50637 | 3/3 |
| github | 3 | 9 | click 3, navigate 1, screenshot 0, snapshot 4, type 0 | 54114 | 13528 | 0 | 0 | 0.0115 | 65298 | – |
| infinite | 3 | 28 | click 2, console 1, navigate 13, screenshot 5, snapshot 5, type 1 | 9831 | 2457 | 5 | 3 | 0.0214 | 68849 | 2/3 |
| long | 3 | 4 | click 1, navigate 1, snapshot 2 | 20330 | 5082 | 0 | 0 | 0.0082 | 51200 | 3/3 |
| modal | 3 | 11 | click 3, navigate 1, snapshot 4, type 3 | 27110 | 6777 | 0 | 0 | 0.0104 | 56681 | 3/3 |
| wikipedia | 3 | 5 | navigate 2, screenshot 1, snapshot 2 | 49748 | 12437 | 1 | 0 | 0.0101 | 62271 | 3/3 |

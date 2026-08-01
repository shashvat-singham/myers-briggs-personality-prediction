"""Compatibility shim.

Inference moved to `mbpp/predictor.py`, which loads the four artifacts once per
process instead of re-reading ~24 MB of joblib files on every call. This module
stays so the notebooks in final_notebooks/ and individual_work/ keep importing
`predict` successfully.
"""
from mbpp.predictor import AXES, Predictor, get_predictor, predict  # noqa: F401


def trace_back(combined):
    """Legacy helper: map per-axis class strings such as "0101" to "INFP"."""
    type_list = [axis["labels"] for axis in AXES]
    result = []
    for num in combined:
        letters = ""
        for index, value in enumerate(num):
            letters += type_list[index][int(value)]
        result.append(letters)
    return result


def combine_classes(y_pred1, y_pred2, y_pred3, y_pred4):
    """Legacy helper: combine four binary predictions into one MBTI code."""
    combined = [
        "%s%s%s%s" % (y_pred1[i], y_pred2[i], y_pred3[i], y_pred4[i])
        for i in range(len(y_pred1))
    ]
    return trace_back(combined)[0]


if __name__ == "__main__":
    import time

    started = time.time()
    sample = (
        "I just wanna to go home!!!!!! :sadpanda: "
        "https://www.youtube.com/watch?v=TQP20LTI84A"
    )
    print(sample)
    print(get_predictor().predict(sample))
    print("Elapsed: %.2f seconds" % (time.time() - started))

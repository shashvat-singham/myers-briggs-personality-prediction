"""Compatibility shim -- feature engineering moved to `mbpp/preprocess.py`.

Kept so the notebooks in final_notebooks/ and individual_work/ continue to work
with `from preprocess import prep_data`.
"""
from mbpp.preprocess import (  # noqa: F401
    clean,
    colons,
    emojis,
    ensure_nltk_data,
    features,
    lemmitize,
    mbti,
    prep_counts,
    prep_data,
    prep_sentiment,
    tag_pos,
    tags_dict,
    unique_words,
)

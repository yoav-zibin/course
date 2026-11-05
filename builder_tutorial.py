"""Collect visible tutorial strings without sending its executable source for translation."""
from html.parser import HTMLParser


class TutorialStrings(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hidden = 0
        self.strings = {}

    def add(self, text):
        if text and text.strip():
            self.strings[text.strip()] = text.strip()

    def handle_starttag(self, tag, attrs):
        if tag in ('script','style','template'):
            self.hidden += 1
        if not self.hidden:
            for key,value in attrs:
                if key in ('alt','title','aria-label','placeholder'): self.add(value)

    def handle_endtag(self, tag):
        if tag in ('script','style','template') and self.hidden: self.hidden -= 1

    def handle_data(self,text):
        if not self.hidden: self.add(text)


def vocabulary(html):
    parser=TutorialStrings()
    parser.feed(html)
    parser.close()
    from game_platform.game_text import extract_strings
    for value in (extract_strings(html) or {}).values(): parser.add(value)
    return list(parser.strings)


def validate_translations(source, translated):
    import re
    if not isinstance(translated, dict) or set(translated) != set(source):
        raise ValueError('Translation must contain exactly the source string keys')
    for key, text in source.items():
        value = translated[key]
        if not isinstance(value, str) or not value.strip():
            raise ValueError('Translation must contain nonempty text: ' + key)
        if sorted(re.findall(r'\{\w+\}', text)) != sorted(re.findall(r'\{\w+\}', value)):
            raise ValueError('Translation changed placeholders: ' + key)

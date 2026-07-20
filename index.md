---
layout: default
---

<div class="hero">
  <h1>Rohit Mukherjee</h1>
  <p class="lede">Essays, calculators, and a few side projects.</p>
</div>

<p style="margin-top: 32px;">
  <a href="{{ '/tools/' | relative_url }}">See the tools &rarr;</a>
</p>

{% comment %}
  Essays and CV sections are hidden for now. Uncomment when there's
  content to show. The individual pages (/tools/, /cv/) still exist.

  <section class="section" id="essays">
    <h2>Essays</h2>
    {% if site.essays.size > 0 %}
      <ul class="essay-list">
        {% assign sorted = site.essays | sort: 'date' | reverse %}
        {% for essay in sorted %}
          <li>
            <a href="{{ essay.url | relative_url }}">{{ essay.title }}</a>
            <span class="essay-date">{{ essay.date | date: "%B %-d, %Y" }}</span>
            {% if essay.excerpt_line %}<p class="essay-excerpt">{{ essay.excerpt_line }}</p>{% endif %}
          </li>
        {% endfor %}
      </ul>
    {% else %}
      <p style="color: var(--muted);">No essays yet.</p>
    {% endif %}
  </section>

  <section class="section" id="cv">
    <h2>CV</h2>
    <a class="cv-link" href="{{ '/assets/cv.pdf' | relative_url }}">Download CV (PDF) <span class="arrow">&darr;</span></a>
  </section>
{% endcomment %}

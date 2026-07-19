---
layout: default
---

<div class="hero">
  <h1>Rohit Mukherjee</h1>
  <p class="lede">Essays, calculators, and a few side projects.</p>
</div>

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

<section class="section" id="tools">
  <h2>Tools</h2>
  <div class="tool-grid">
    <article class="tool">
      <span class="tag">Real estate</span>
      <h3><a href="/singapore-apartment/">Singapore Rental Property Investment Calculator</a></h3>
      <p>Aggregates URA-style condo transaction data into per-project yield tables, computes after-tax cash flow with Singapore's real BSD, ABSD, and progressive-tax rules, and overlays a stochastic price-rent model.</p>
      <a class="cta" href="/singapore-apartment/">Open</a>
    </article>
  </div>
</section>

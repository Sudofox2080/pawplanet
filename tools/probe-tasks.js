(function () {
  var h = document.querySelector('.tasks-hero');
  var p = h.parentElement;
  var sel = '.main > [class$="-page"] > *';
  return JSON.stringify({
    parent: p.className,
    pgrand: p.parentElement.className,
    heroMatches: h.matches(sel),
    heroMinWidth: getComputedStyle(h).minWidth,
    pageCols: getComputedStyle(p).gridTemplateColumns,
    docW: document.documentElement.scrollWidth,
  });
})()

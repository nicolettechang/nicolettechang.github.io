// floating cat: fades in after scrolling down, links back to #top
(function () {
  var cat = document.querySelector('.to-top');
  if (!cat) return;
  function update() {
    cat.toggleAttribute('data-hidden', window.scrollY < 400);
  }
  update();
  window.addEventListener('scroll', update, { passive: true });
})();

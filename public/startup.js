(function () {
  function failed() {
    var message = document.getElementById("startup-message");
    var help = document.getElementById("startup-help");
    if (!message || !help) return;
    message.textContent = "页面脚本加载失败";
    help.textContent =
      "可能是旧页面缓存或浏览器代理阻止了资源加载。请重新加载页面；仍失败时，将浏览器控制台的报错反馈给维护者。";
  }
  function bindRetry() {
    var retry = document.getElementById("startup-retry");
    if (!retry) return;
    retry.addEventListener("click", function (event) {
      event.preventDefault();
      var next = new URL(location.href);
      next.searchParams.set("v", String(Date.now()));
      location.replace(next.href);
    });
  }
  bindRetry();
  window.addEventListener("error", failed, true);
  window.addEventListener("unhandledrejection", failed);
  window.setTimeout(failed, 10000);
})();

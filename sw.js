const CACHE_NAME = "utility-geo-guess-assets-v1";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./token.txt",
  "./images/gps.csv",
  "./landing/landing.png",
  "./logo/logo.jpg",
  "./screensaver/slides.csv"
];

self.addEventListener("install",event=>{
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache=>
      Promise.allSettled(CORE_ASSETS.map(asset=>cache.add(asset)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch",event=>{
  const request = event.request;
  if(request.method !== "GET") return;

  const url = new URL(request.url);
  if(url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request,{ignoreSearch:true}).then(cached=>{
      if(cached) return cached;

      return fetch(request).then(response=>{
        if(!response || response.status !== 200 || response.type === "opaque") return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache=>cache.put(request,clone));
        return response;
      });
    })
  );
});

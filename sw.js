const CACHE_NAME = "utility-geo-guess-assets-v2";

const CORE_ASSETS = [
  "./index.html",
  "./token.txt",
  "./images/gps.csv",
  "./landing/landing.png",
  "./logo/logo.jpg",
  "./screensaver/slides.csv"
];


/* =========================================================
   INSTALL
   ========================================================= */

self.addEventListener(
  "install",
  event => {

    event.waitUntil(

      caches
        .open(CACHE_NAME)
        .then(cache =>
          Promise.allSettled(
            CORE_ASSETS.map(
              asset => cache.add(asset)
            )
          )
        )

    );

    self.skipWaiting();

  }
);


/* =========================================================
   ACTIVATE
   Remove older versions of the cache
   ========================================================= */

self.addEventListener(
  "activate",
  event => {

    event.waitUntil(

      caches
        .keys()
        .then(keys =>
          Promise.all(
            keys
              .filter(
                key =>
                  key.startsWith(
                    "utility-geo-guess-assets-"
                  ) &&
                  key !== CACHE_NAME
              )
              .map(
                key =>
                  caches.delete(key)
              )
          )
        )
        .then(() =>
          self.clients.claim()
        )

    );

  }
);


/* =========================================================
   FETCH
   ========================================================= */

self.addEventListener(
  "fetch",
  event => {

    const request =
      event.request;


    if(
      request.method !== "GET"
    ){
      return;
    }


    const url =
      new URL(
        request.url
      );


    /*
      Do not interfere with Mapbox, Supabase
      or any other external resources.
    */

    if(
      url.origin !==
      self.location.origin
    ){
      return;
    }


    /*
      HTML / navigation requests:

      NETWORK FIRST
      ----------------
      This ensures that a newly deployed index.html
      is used whenever the internet is available.

      If the network is unavailable,
      fall back to the cached version.
    */

    if(
      request.mode === "navigate" ||
      url.pathname.endsWith("/") ||
      url.pathname.endsWith("/index.html")
    ){

      event.respondWith(

        fetch(request)

          .then(response => {

            if(
              response &&
              response.status === 200
            ){

              const copy =
                response.clone();


              caches
                .open(CACHE_NAME)
                .then(cache =>
                  cache.put(
                    "./index.html",
                    copy
                  )
                );

            }


            return response;

          })

          .catch(async () => {

            const cache =
              await caches.open(
                CACHE_NAME
              );


            return (
              await cache.match(
                "./index.html"
              )
            );

          })

      );


      return;

    }


    /*
      Local game assets:

      CACHE FIRST
      ----------------
      Images, landing graphics, screensaver
      and local configuration files are loaded
      from cache when available.

      If missing, retrieve from network and cache.
    */

    event.respondWith(

      caches
        .match(
          request,
          {
            ignoreSearch:true
          }
        )
        .then(cached => {

          if(cached){
            return cached;
          }


          return fetch(request)

            .then(response => {

              if(
                !response ||
                response.status !== 200 ||
                response.type === "opaque"
              ){
                return response;
              }


              const copy =
                response.clone();


              caches
                .open(CACHE_NAME)
                .then(cache =>
                  cache.put(
                    request,
                    copy
                  )
                );


              return response;

            });

        })

    );

  }
);
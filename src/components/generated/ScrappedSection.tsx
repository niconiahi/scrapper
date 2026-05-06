import './ScrappedSection.css'

const arrowSvg = (
  <svg width="18" height="15" viewBox="0 0 18 15" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path
      d="M13.386 8.2844L0.0834957 8.2844L0.0834958 6.22732L13.386 6.22732L9.20486 1.71022L10.5707 0.255859L17.0835 7.25586L10.5707 14.2559L9.20486 12.8015L13.386 8.2844Z"
      fill="currentColor"
    />
  </svg>
)

export function ScrappedSection() {
  return (
    <section
      data-testid="scrapped-section"
      className="section white-brand-shapes giftcarxd-valentine"
    >
      <div className="container-2">
        <div className="wrapper-center-section-2 valentine-bloomgift">
          <div className="ticket-giftcard ticketcard-valentine">
            <div className="title-gift-card">
              <div className="titulo-copy-2">
                <div className="titulo-giftcard">
                  <div className="title-subtitle giftcard">
                    <div className="main-title giftcard">Bloom Gift Card</div>
                    <div className="subtitle-giftcard">
                      The gift of flavor and moments
                    </div>
                  </div>
                </div>
                <div className="bajada-giftcard">
                  Give the gift of Bloom Room. Each card is an invitation to
                  enjoy fresh flavors, warm moments and a cozy chic atmosphere.
                  Perfect for birthdays, special occasions or just to brighten
                  someone’s day.
                </div>
              </div>
              <a
                className="button w-inline-block"
                href="https://www.toasttab.com/suwanee-social-buford-350-town-center/giftcards"
                target="_blank"
                rel="noopener noreferrer"
              >
                <div className="text-cta">get yours</div>
                <div className="arrow-svg w-embed">{arrowSvg}</div>
              </a>
            </div>
            <div className="zoom-overflow-ticket">
              <img
                className="ticket-image"
                src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/6900f44ea4f28fbf0f1c6564_Picture-p-500.webp"
                srcSet="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/6900f44ea4f28fbf0f1c6564_Picture-p-500.webp 500w, https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/6900f44ea4f28fbf0f1c6564_Picture.webp 600w"
                sizes="(max-width: 600px) 100vw, 600px"
                loading="lazy"
                alt=""
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

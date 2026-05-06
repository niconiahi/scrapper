// Auto-extracted by /extract_components from: page (/), menu (/menu).
// Class signature (skip key): 'navbar w-nav'
//
// Edit by hand if needed — the skill detects manual edits and won't clobber.
// Static. Page-dependent state (.w--current / aria-current) is applied at
// runtime by src/components/interactive/currentLink.ts.
export function Header() {
  return (
    <div>
      <div>
        <div className="spacing-top" />
        <div className="navbar w-nav" data-animation="default" data-collapse="medium" data-duration="400" data-easing="ease" data-easing2="ease" role="banner">
          <div className="container">
            <div className="wrapper-navigation">
              <a className="brand w-inline-block" href="/">
                <img className="desktop-logo" width="205.5" loading="lazy" alt="" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/68f6631c1e8bf9f29b70fb24_logo%20header.webp" />
                <img className="mobile-logo nav" width="40.5" loading="lazy" alt="" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/68f19fd7ba060c0716b128db_Logo%20Mobile.webp" />
              </a>
              <div className="menu-items">
                <a className="item-header w-inline-block" href="/">
                  <div className="text-item-nav">
                    {`home`}
                  </div>
                </a>
                <a className="item-header w-inline-block" href="/menu">
                  <div className="text-item-nav">
                    {`menu`}
                  </div>
                </a>
                <a className="item-header hide w-inline-block" href="#">
                  <div className="text-item-nav">
                    {`Reservations`}
                  </div>
                </a>
                <div className="w-dropdown" data-delay="0" data-hover="true">
                  <div className="item-header w-dropdown-toggle" id="w-dropdown-toggle-0" aria-controls="w-dropdown-list-0" aria-haspopup="menu" aria-expanded="false" role="button" tabIndex="0">
                    <div className="text-item-nav">
                      {`more`}
                    </div>
                    <img className="arrow-down" width="24" height="24" alt="" src="https://cdn.prod.website-files.com/67f91354184ac29dc18b3aca/68b0a2139f9c1466bd0ec538_Arrow-Down.svg" loading="lazy" />
                  </div>
                  <nav className="drop-menu w-dropdown-list" id="w-dropdown-list-0" aria-labelledby="w-dropdown-toggle-0" style={{ height: "0px" }}>
                    <div className="wrapper-columns">
                      <div className="column-nav">
                        <a className="secondary-nav-item w-inline-block" href="/contact-us" tabIndex="0">
                          <div className="icon-nav-menu">
                            <img loading="lazy" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/68f19ce434943c7f99614052_Contact%20Us.svg" alt="" />
                          </div>
                          <div className="content-item">
                            <div className="text-block">
                              {`Contact Us`}
                            </div>
                            <div className="text-block-2">
                              {`Reach out with any questions or just say hello.`}
                            </div>
                          </div>
                        </a>
                        <a className="secondary-nav-item w-inline-block" href="/reservations" tabIndex="0">
                          <div className="icon-nav-menu-2">
                            <img loading="lazy" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/68f1a2245c819ce9485dd8cd_Reservations.svg" alt="" />
                          </div>
                          <div className="content-item">
                            <div className="text-block">
                              {`Reservations`}
                            </div>
                            <div className="text-block-2">
                              {`Your celebration, our space`}
                            </div>
                          </div>
                        </a>
                        <a className="secondary-nav-item w-inline-block" href="/catering" tabIndex="0">
                          <div className="icon-nav-menu">
                            <img loading="lazy" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/6914e069166e3a2418572dff_catering%20bloom.svg" alt="" />
                          </div>
                          <div className="content-item">
                            <div className="text-block">
                              <strong>
                                {`Catering`}
                              </strong>
                            </div>
                            <div className="text-block-2">
                              {`Signature gatherings with warmth and care`}
                            </div>
                          </div>
                        </a>
                      </div>
                      <div className="column-nav">
                        <a className="secondary-nav-item w-inline-block" href="/about-us" tabIndex="0">
                          <div className="icon-nav-menu">
                            <img loading="lazy" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/68f19ce4ad4917c047e43d6b_Logo%20Mobile.svg" alt="" />
                          </div>
                          <div className="content-item">
                            <div className="text-block">
                              <strong>
                                {`About Us`}
                              </strong>
                            </div>
                            <div className="text-block-2">
                              {`Discover the flavors, and vibe behind Bloom Room.`}
                            </div>
                          </div>
                        </a>
                        <a className="secondary-nav-item w-inline-block" href="/giftcard" tabIndex="0">
                          <div className="icon-nav-menu-2">
                            <div className="icon-navbar w-embed">
                              <span width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" dangerouslySetInnerHTML={{ __html: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M28.8 19.9474H3.2V10.4737H11.328L8 14.9421L10.592 16.7895L14.4 11.6737L16 9.52632L17.6 11.6737L21.408 16.7895L24 14.9421L20.672 10.4737H28.8M28.8 27.8421H3.2V24.6842H28.8M11.2 4.15789C11.6243 4.15789 12.0313 4.32425 12.3314 4.62036C12.6314 4.91647 12.8 5.31808 12.8 5.73684C12.8 6.15561 12.6314 6.55722 12.3314 6.85333C12.0313 7.14944 11.6243 7.31579 11.2 7.31579C10.7757 7.31579 10.3687 7.14944 10.0686 6.85333C9.76857 6.55722 9.6 6.15561 9.6 5.73684C9.6 5.31808 9.76857 4.91647 10.0686 4.62036C10.3687 4.32425 10.7757 4.15789 11.2 4.15789ZM20.8 4.15789C21.2243 4.15789 21.6313 4.32425 21.9314 4.62036C22.2314 4.91647 22.4 5.31808 22.4 5.73684C22.4 6.15561 22.2314 6.55722 21.9314 6.85333C21.6313 7.14944 21.2243 7.31579 20.8 7.31579C20.3757 7.31579 19.9687 7.14944 19.6686 6.85333C19.3686 6.55722 19.2 6.15561 19.2 5.73684C19.2 5.31808 19.3686 4.91647 19.6686 4.62036C19.9687 4.32425 20.3757 4.15789 20.8 4.15789ZM28.8 7.31579H25.312C25.488 6.82632 25.6 6.28947 25.6 5.73684C25.6 4.48055 25.0943 3.27572 24.1941 2.38739C23.2939 1.49906 22.073 1 20.8 1C19.12 1 17.664 1.85263 16.8 3.13158L16 4.15789L15.2 3.11579C14.336 1.85263 12.88 1 11.2 1C9.92696 1 8.70606 1.49906 7.80589 2.38739C6.90571 3.27572 6.4 4.48055 6.4 5.73684C6.4 6.28947 6.512 6.82632 6.688 7.31579H3.2C1.424 7.31579 0 8.72105 0 10.4737V27.8421C0 29.5947 1.424 31 3.2 31H28.8C30.576 31 32 29.5947 32 27.8421V10.4737C32 8.72105 30.576 7.31579 28.8 7.31579Z" fill="currentcolor"></path>
</svg>` }} />
                            </div>
                            <div className="w-embed" />
                          </div>
                          <div className="content-item">
                            <div className="text-block">
                              {`Gift Card`}
                            </div>
                            <div className="text-block-2">
                              {`Good taste, better gift`}
                            </div>
                          </div>
                        </a>
                        <a className="secondary-nav-item w-inline-block" href="/careers" tabIndex="0">
                          <div className="icon-nav-menu">
                            <img loading="lazy" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/6916504778c3bd0a8756443f_Jobs.svg" alt="" />
                          </div>
                          <div className="content-item">
                            <div className="text-block">
                              <strong>
                                {`Careers`}
                              </strong>
                            </div>
                            <div className="text-block-2">
                              {`Join our team at Bloom Room`}
                            </div>
                          </div>
                        </a>
                      </div>
                    </div>
                  </nav>
                </div>
              </div>
              <div className="buttons-wrap-nav">
                <a className="button w-inline-block" href="/order-online">
                  <div className="text-cta btn">
                    {`order online`}
                  </div>
                </a>
                <a className="instagram-button w-inline-block" href="https://www.instagram.com/bloomroomsocial/" target="_blank">
                  <span className="svg" width="100%" height="100%" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" dangerouslySetInnerHTML={{ __html: `<svg width="100%" height="100%" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="svg"><path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.917 3.917 0 0 0-1.417.923A3.927 3.927 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.916 3.916 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.926 3.926 0 0 0-.923-1.417A3.911 3.911 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 7.998 0h.003zm-.717 1.442h.718c2.136 0 2.389.007 3.232.046.78.035 1.204.166 1.486.275.373.145.64.319.92.599.28.28.453.546.598.92.11.281.24.705.275 1.485.039.843.047 1.096.047 3.231s-.008 2.389-.047 3.232c-.035.78-.166 1.203-.275 1.485a2.47 2.47 0 0 1-.599.919c-.28.28-.546.453-.92.598-.28.11-.704.24-1.485.276-.843.038-1.096.047-3.232.047s-2.39-.009-3.233-.047c-.78-.036-1.203-.166-1.485-.276a2.478 2.478 0 0 1-.92-.598 2.48 2.48 0 0 1-.6-.92c-.109-.281-.24-.705-.275-1.485-.038-.843-.046-1.096-.046-3.233 0-2.136.008-2.388.046-3.231.036-.78.166-1.204.276-1.486.145-.373.319-.64.599-.92.28-.28.546-.453.92-.598.282-.11.705-.24 1.485-.276.738-.034 1.024-.044 2.515-.045v.002zm4.988 1.328a.96.96 0 1 0 0 1.92.96.96 0 0 0 0-1.92zm-4.27 1.122a4.109 4.109 0 1 0 0 8.217 4.109 4.109 0 0 0 0-8.217zm0 1.441a2.667 2.667 0 1 1 0 5.334 2.667 2.667 0 0 1 0-5.334z" fill="currentColor"></path></svg>` }} />
                </a>
                <a className="burger-menu w-inline-block" href="#">
                  <img loading="lazy" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/68efbcfc00d6284c1394392a_Burger%20Menu.svg" alt="" />
                </a>
              </div>
            </div>
            <div className="menu-mobile" style={{ display: "none" }}>
              <div className="top-bar-mobile-menu">
                <a className="brand w-inline-block" href="#">
                  <img className="mobile-logo" width="40.5" loading="lazy" alt="" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/68f19fd7ba060c0716b128db_Logo%20Mobile.webp" />
                </a>
                <a className="close-button w-inline-block" href="#">
                  <img loading="lazy" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/68f1a346f76f7f69235cd35c_Cross.svg" alt="" />
                </a>
              </div>
              <div className="wrapper-mobile-menu">
                <a className="secondary-nav-item w-inline-block" href="/">
                  <div className="icon-nav-menu">
                    <img loading="lazy" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/68f1a224aa41812181507075_Home.svg" alt="" />
                  </div>
                  <div className="content-item">
                    <div className="text-block">
                      {`Home`}
                    </div>
                  </div>
                </a>
                <a className="secondary-nav-item w-inline-block" href="/menu-old">
                  <div className="icon-nav-menu">
                    <img loading="lazy" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/68f1a224789dc5bbe985fd2d_Menu.svg" alt="" />
                  </div>
                  <div className="content-item">
                    <div className="text-block">
                      {`Menu`}
                    </div>
                  </div>
                </a>
                <a className="secondary-nav-item hide w-inline-block" href="#">
                  <div className="icon-nav-menu">
                    <img loading="lazy" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/68efbcfc00d6284c13943930_material-symbols_hand-meal-rounded.svg" alt="" />
                  </div>
                  <div className="content-item">
                    <div className="text-block">
                      {`Catering`}
                    </div>
                  </div>
                </a>
                <a className="secondary-nav-item w-inline-block" href="/reservations">
                  <div className="icon-nav-menu">
                    <img loading="lazy" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/68f1a2245c819ce9485dd8cd_Reservations.svg" alt="" />
                  </div>
                  <div className="content-item">
                    <div className="text-block">
                      {`Reservations`}
                    </div>
                  </div>
                </a>
                <a className="secondary-nav-item hide w-inline-block" href="#">
                  <div className="icon-nav-menu">
                    <img loading="lazy" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/68efbcfc00d6284c13943934_Specials.svg" alt="" />
                  </div>
                  <div className="content-item">
                    <div className="text-block">
                      {`Happenings`}
                    </div>
                  </div>
                </a>
                <a className="secondary-nav-item hide w-inline-block" href="#">
                  <div className="icon-nav-menu">
                    <img loading="lazy" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/68efbcfc00d6284c13943935_Jobs.svg" alt="" />
                  </div>
                  <div className="content-item">
                    <div className="text-block">
                      {`Jobs`}
                    </div>
                  </div>
                </a>
                <a className="secondary-nav-item w-inline-block" href="/catering">
                  <div className="icon-nav-menu-2">
                    <img loading="lazy" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/6914e069166e3a2418572dff_catering%20bloom.svg" alt="" />
                  </div>
                  <div className="content-item">
                    <div className="text-block">
                      {`Catering`}
                    </div>
                  </div>
                </a>
                <a className="secondary-nav-item w-inline-block" href="/about-us">
                  <div className="icon-nav-menu">
                    <img loading="lazy" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/68f19ce4ad4917c047e43d6b_Logo%20Mobile.svg" alt="" />
                  </div>
                  <div className="content-item">
                    <div className="text-block">
                      {`About Us`}
                    </div>
                  </div>
                </a>
                <a className="secondary-nav-item w-inline-block" href="/giftcard">
                  <div className="icon-nav-menu-2">
                    <div className="icon-navbar w-embed">
                      <span width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" dangerouslySetInnerHTML={{ __html: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M28.8 19.9474H3.2V10.4737H11.328L8 14.9421L10.592 16.7895L14.4 11.6737L16 9.52632L17.6 11.6737L21.408 16.7895L24 14.9421L20.672 10.4737H28.8M28.8 27.8421H3.2V24.6842H28.8M11.2 4.15789C11.6243 4.15789 12.0313 4.32425 12.3314 4.62036C12.6314 4.91647 12.8 5.31808 12.8 5.73684C12.8 6.15561 12.6314 6.55722 12.3314 6.85333C12.0313 7.14944 11.6243 7.31579 11.2 7.31579C10.7757 7.31579 10.3687 7.14944 10.0686 6.85333C9.76857 6.55722 9.6 6.15561 9.6 5.73684C9.6 5.31808 9.76857 4.91647 10.0686 4.62036C10.3687 4.32425 10.7757 4.15789 11.2 4.15789ZM20.8 4.15789C21.2243 4.15789 21.6313 4.32425 21.9314 4.62036C22.2314 4.91647 22.4 5.31808 22.4 5.73684C22.4 6.15561 22.2314 6.55722 21.9314 6.85333C21.6313 7.14944 21.2243 7.31579 20.8 7.31579C20.3757 7.31579 19.9687 7.14944 19.6686 6.85333C19.3686 6.55722 19.2 6.15561 19.2 5.73684C19.2 5.31808 19.3686 4.91647 19.6686 4.62036C19.9687 4.32425 20.3757 4.15789 20.8 4.15789ZM28.8 7.31579H25.312C25.488 6.82632 25.6 6.28947 25.6 5.73684C25.6 4.48055 25.0943 3.27572 24.1941 2.38739C23.2939 1.49906 22.073 1 20.8 1C19.12 1 17.664 1.85263 16.8 3.13158L16 4.15789L15.2 3.11579C14.336 1.85263 12.88 1 11.2 1C9.92696 1 8.70606 1.49906 7.80589 2.38739C6.90571 3.27572 6.4 4.48055 6.4 5.73684C6.4 6.28947 6.512 6.82632 6.688 7.31579H3.2C1.424 7.31579 0 8.72105 0 10.4737V27.8421C0 29.5947 1.424 31 3.2 31H28.8C30.576 31 32 29.5947 32 27.8421V10.4737C32 8.72105 30.576 7.31579 28.8 7.31579Z" fill="currentcolor"></path>
</svg>` }} />
                    </div>
                    <div className="w-embed" />
                  </div>
                  <div className="content-item">
                    <div className="text-block">
                      {`Gift Card`}
                    </div>
                  </div>
                </a>
                <a className="secondary-nav-item hide w-inline-block" href="#">
                  <div className="icon-nav-menu">
                    <img loading="lazy" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/68efbcfc00d6284c1394392e_Privacy%20Policy.svg" alt="" />
                  </div>
                  <div className="content-item">
                    <div className="text-block">
                      {`privacy policy`}
                    </div>
                  </div>
                </a>
                <a className="secondary-nav-item w-inline-block" href="/careers">
                  <div className="icon-nav-menu-2">
                    <img loading="lazy" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/6916504778c3bd0a8756443f_Jobs.svg" alt="" />
                  </div>
                  <div className="content-item">
                    <div className="text-block">
                      {`Careers`}
                    </div>
                  </div>
                </a>
                <a className="secondary-nav-item w-inline-block" href="/contact-us">
                  <div className="icon-nav-menu">
                    <img loading="lazy" src="https://cdn.prod.website-files.com/68ef9c3d52fb312eeda9b556/68f19ce434943c7f99614052_Contact%20Us.svg" alt="" />
                  </div>
                  <div className="content-item">
                    <div className="text-block">
                      {`Contact Us`}
                    </div>
                  </div>
                </a>
              </div>
              <div className="bot-bar-button">
                <a className="button mobile-menu-burger w-inline-block" href="#">
                  <div className="text-cta">
                    {`Reservation`}
                  </div>
                </a>
              </div>
            </div>
          </div>
          <div className="w-nav-overlay" data-wf-ignore="" id="w-nav-overlay-0" />
        </div>
      </div>
    </div>
  )
}

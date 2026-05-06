import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ScrappedSection } from './ScrappedSection'

describe('ScrappedSection', () => {
  it('renders the gift card heading and CTA', () => {
    render(<ScrappedSection />)
    expect(screen.getByTestId('scrapped-section')).toBeInTheDocument()
    expect(screen.getByText('Bloom Gift Card')).toBeInTheDocument()
    expect(
      screen.getByText('The gift of flavor and moments'),
    ).toBeInTheDocument()
    expect(screen.getByText('get yours')).toBeInTheDocument()
  })

  it('links the CTA to the Toast giftcards page', () => {
    render(<ScrappedSection />)
    const cta = screen.getByText('get yours').closest('a')
    expect(cta).toHaveAttribute(
      'href',
      'https://www.toasttab.com/suwanee-social-buford-350-town-center/giftcards',
    )
    expect(cta).toHaveAttribute('target', '_blank')
    expect(cta).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

function setViewport(mobile: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 920px)' ? mobile : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

afterEach(() => cleanup())

describe('移动侧栏焦点语义', () => {
  it('关闭时 inert，打开后循环焦点，Escape、工具与最近使用选择后归还菜单焦点', async () => {
    setViewport(true)
    render(<App />)
    const menu = screen.getByRole('button', { name: '打开工具导航' })
    const sidebar = document.querySelector<HTMLElement>('#tool-navigation')!

    expect(sidebar).toHaveAttribute('aria-hidden', 'true')
    expect(sidebar).toHaveAttribute('inert')
    fireEvent.click(menu)
    const close = await within(sidebar).findByRole('button', { name: '关闭导航' })
    await waitFor(() => expect(close).toHaveFocus())
    expect(sidebar).not.toHaveAttribute('aria-hidden')
    expect(sidebar).not.toHaveAttribute('inert')

    const lastNavigationItem = within(sidebar).getByRole('button', { name: 'Skill 静态校验' })
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(lastNavigationItem).toHaveFocus()
    fireEvent.keyDown(lastNavigationItem, { key: 'Tab' })
    expect(close).toHaveFocus()

    fireEvent.keyDown(close, { key: 'Escape' })
    expect(menu).toHaveFocus()
    expect(sidebar).toHaveAttribute('inert')

    fireEvent.click(menu)
    const json = await within(sidebar).findByRole('button', { name: 'JSON 格式化' })
    fireEvent.click(json)
    expect(menu).toHaveFocus()
    expect(sidebar).toHaveAttribute('inert')
    expect(screen.getByRole('heading', { name: 'JSON 格式化' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '载入示例' }))
    fireEvent.click(screen.getByRole('button', { name: /格式化并校验/ }))
    expect(screen.getByText('校验通过')).toBeVisible()
    fireEvent.click(menu)
    const recent = sidebar.querySelector<HTMLElement>('.recent')!
    const recentJson = within(recent).getByRole('button', { name: /JSON 格式化/ })
    recentJson.focus()
    fireEvent.keyDown(recentJson, { key: 'Enter' })
    fireEvent.click(recentJson)
    expect(menu).toHaveFocus()
    expect(sidebar).toHaveAttribute('inert')
  })

  it('桌面侧栏不应用隐藏语义且导航可聚焦', () => {
    setViewport(false)
    render(<App />)
    const sidebar = document.querySelector<HTMLElement>('#tool-navigation')!
    const firstNavigationItem = within(sidebar).getByRole('button', { name: 'JSON 格式化' })
    expect(sidebar).not.toHaveAttribute('aria-hidden')
    expect(sidebar).not.toHaveAttribute('inert')
    firstNavigationItem.focus()
    expect(firstNavigationItem).toHaveFocus()
  })
})

describe('无端口核心计时回归', () => {
  it('组件内置 JSON 示例核心路径在 5 秒内产生成功结果', () => {
    setViewport(false)
    const startedAt = performance.now()
    render(<App />)
    fireEvent.click(document.querySelector<HTMLButtonElement>('.tool-card')!)
    fireEvent.click(screen.getByRole('button', { name: '载入示例' }))
    fireEvent.click(screen.getByRole('button', { name: /格式化并校验/ }))
    expect(screen.getByText('校验通过')).toBeVisible()
    expect(document.querySelector('.code-output')).toHaveTextContent('"name": "LocalKit"')
    expect(performance.now() - startedAt).toBeLessThanOrEqual(5_000)
  })
})

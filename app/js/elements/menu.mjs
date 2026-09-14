import { Panel } from './panel.mjs';
import { isFunction } from './utils.mjs';

let MenuOpen = false
let CurrentMenu = null

const getMenuItems = (menu) =>
	[...menu.querySelectorAll("ui-menu-item")].filter((item) => !item.hasAttribute("disabled"))

export class Menu extends Panel {
	constructor(content) {
		super(content)
		this.on("contextmenu", (e) => {
			e.preventDefault()
		})
	}

	connectedCallback() {
		super.connectedCallback.apply(this)
		const origin = this.getAttribute("showAt")
		if (origin) {
			const el = document.querySelector(origin)
			this.showAt(el)
		}
		const attach = this.getAttribute("attachTo")
		if (attach) {
			const el = document.querySelector(attach)
			if (el) {
				el.on("click", () => {
					if (MenuOpen && CurrentMenu == this) return
					setTimeout(() => {
						MenuOpen = false
						this.showAt(el)
					})
				})
			}
			if (el) {
				el.on("pointerover", () => {
					if (MenuOpen && CurrentMenu == this) return
					if (MenuOpen) {
						el.focus()
						el.click()
					}
				})
			}
		}

		const click = this.getAttribute("onclick")
		if (click) {
			this._click = eval(click)
		}
	}

	set click(v) {
		if (!isFunction(v)) throw new Error("click must be a function")
		this._click = v
	}

	click(command) {
		if ("function" == typeof this._click) {
			this._click(command)
		}
	}

	showAt(origin) {
		if (!this.parentElement) {
			document.body.appendChild(this);
		}
		// const self = this
		let p

		// Remember who opened this menu so we can restore focus when it closes.
		this._opener = origin instanceof PointerEvent ? origin.target : origin
		if (!(this._opener instanceof HTMLElement)) this._opener = null


		// clear styling for left/up combos
		this.removeAttribute("left")
		this.removeAttribute("up")

		if (origin instanceof PointerEvent) {
			p = {
				x: origin.clientX + 2,
				y: origin.clientY + 2,
				w: 0,
				h: 0,
			}
			this.style.left = `${p.x}px`
			this.style.top = `${p.y + p.h}px`
			this.style.bottom = ""
			// this.style.maxHeight = `calc(100vh - ${p.y + p.h + 8}px)`
		} else if (origin instanceof HTMLElement) {
			p = getPosition(origin)
			this.style.left = `${p.x}px`
			this.style.top = `${p.y + p.h}px`
			this.style.bottom = ""
		} else {
			throw new Error("showAt requires an HTMLElement in the current DOM or a PointerEvent")
		}

		setTimeout(() => {
			if (p.x + this.offsetWidth > window.innerWidth) {
				this.setAttribute("left", "")
				this.style.left = p.x + p.w - this.offsetWidth
			}
			if (p.y + p.h + this.offsetHeight > window.innerHeight) {
				if (p.y + p.h > window.innerHeight / 2) {
					// displat ABOVE the orgin
					this.setAttribute("up", "")
					this.style.top = "auto" //p.y - (this.offsetHeight-32)
					this.style.bottom = `${window.innerHeight - p.y}px`
					this.style.maxHeight = `calc(100vh - ${window.innerHeight - p.y + 16}px)`
				} else {
					this.style.maxHeight = `calc(100vh - ${p.y + p.h + 16}px)`
				}
			} else {
				this.style.maxHeight = `calc(100vh - ${p.y + p.h + 16}px)`
			}
		})

		const event = new CustomEvent("show")
		this.dispatchEvent(event)

		setTimeout(() => {
			if (CurrentMenu === this) {
				CurrentMenu.removeAttribute("active")
				CurrentMenu = null
				return
			}

			let clicked = false
			MenuOpen = true
			CurrentMenu = this
			this.on("click",
				() => {
					clicked = true
					MenuOpen = false
					CurrentMenu = null
					setTimeout(() => {
						this.removeAttribute("active")
					}, 333)
				},
				{ once: true }
			)
			document.addEventListener("click",
				() => {
					if (!clicked && MenuOpen) {
						setTimeout(() => {
							this.removeAttribute("active")
							MenuOpen = false
							CurrentMenu = null
							this._restoreFocus()
						})
					}
				},
				{ once: true }
			)
			document.addEventListener("contextmenu",
				() => {
					if (CurrentMenu == this) {
						CurrentMenu.removeAttribute("active")
						return
					}
					if (!clicked && MenuOpen) {
						setTimeout(() => {
							this.removeAttribute("active")
							MenuOpen = false
							CurrentMenu = null
							this._restoreFocus()
						})
					}
				},
				{ once: true }
			)
		})
		this.setAttribute("active", "true")

		// Focus the first enabled menu item so arrow keys drive navigation immediately.
		setTimeout(() => {
			const items = getMenuItems(this)
			if (items.length > 0 && this.hasAttribute("active")) {
				items[0].focus({ preventScroll: true })
			}
		}, 16)
	}

	_restoreFocus() {
		if (this._opener && this._opener.isConnected) {
			this._opener.focus({ preventScroll: true })
		}
	}

	/**
	 * Keyboard navigation for an open menu. Registered at capture time on
	 * document (see module scope below) so it runs before window.ui.commands'
	 * global keydown handler. Returns true when the event was handled.
	 */
	_handleKeydown(e) {
		if (!MenuOpen || CurrentMenu !== this || !this.hasAttribute("active")) return false
		const items = getMenuItems(this)
		if (items.length === 0) return false

		const active = document.activeElement
		const currentIsItem = active instanceof HTMLElement && items.includes(active)
		let index = currentIsItem ? items.indexOf(active) : -1

		switch (e.key) {
			case "ArrowDown":
				index = currentIsItem ? (index + 1) % items.length : 0
				break
			case "ArrowUp":
				index = currentIsItem ? (index - 1 + items.length) % items.length : items.length - 1
				break
			case "Home":
				index = 0
				break
			case "End":
				index = items.length - 1
				break
			case "Enter":
			case " ":
				if (currentIsItem && !active.hasAttribute("disabled")) {
					e.preventDefault()
					e.stopImmediatePropagation()
					active.click()
					return true
				}
				return false
			case "Escape":
				e.preventDefault()
				e.stopImmediatePropagation()
				this.removeAttribute("active")
				MenuOpen = false
				CurrentMenu = null
				this._restoreFocus()
				return true
			default:
				return false
		}

		e.preventDefault()
		e.stopImmediatePropagation()
		// Skip over disabled items in the chosen direction.
		for (let i = 0; i < items.length; i++) {
			const target = items[index % items.length]
			if (!target.hasAttribute("disabled")) {
				target.focus({ preventScroll: true })
				target.scrollIntoView({ block: "nearest" })
				return true
			}
			index += (e.key === "ArrowDown") ? 1 : -1
		}
		return true
	}
}

const getWindowY = (e) => {
	let y = e.offsetTop
	return e.parentNode instanceof HTMLElement ? y + getWindowY(e.parentNode) : y
}
const getWindowX = (e) => {
	let x = e.offsetLeft
	return e.parentNode instanceof HTMLElement ? x + getWindowX(e.parentNode) : x
}

const getPosition = (el) => {
	let x = getWindowX(el)
	let y = getWindowY(el)
	return {
		x: x,
		y: y,
		w: el.offsetWidth,
		h: el.offsetHeight,
	}
}

// Capture-phase keyboard controller for menus. Registered here (menu.mjs is imported
// before main.mjs), so it runs before window.ui.commands' own capture listener and can
// stopImmediatePropagation() for menu-only keys (arrows, Home/End, Enter, Escape) while
// a menu is open — without eating keys when no menu is open.
document.addEventListener(
	"keydown",
	(e) => {
		if (!MenuOpen || !CurrentMenu) return
		CurrentMenu._handleKeydown(e)
	},
	{ capture: true }
)

customElements.define("ui-menu", Menu);
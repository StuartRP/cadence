import { Panel } from './panel.mjs';
import { isFunction } from './utils.mjs';

let MenuOpen = false
let CurrentMenu = null

// Last pointer position (tracked so we can detect a cursor already resting over
// the menu when it opens).
let PointerX = -1
let PointerY = -1

const getMenuItems = (menu) =>
	[...menu.querySelectorAll("ui-menu-item")].filter((item) => !item.hasAttribute("disabled"))

export class Menu extends Panel {
	constructor(content) {
		super(content)
		this.on("contextmenu", (e) => {
			e.preventDefault()
		})
		// Pointer-driven mode: when the cursor moves over the menu it takes
		// over selection (mouse selection), and keyboard resumes from there.
		this._pointerItem = null
		this._pointerActive = false
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

		// Mouse hover takes over selection while the cursor is over the menu.
		this.addEventListener("pointerover", (e) => {
			if (!this.hasAttribute("active")) return
			const item = e.target instanceof Element ? e.target.closest("ui-menu-item") : null
			if (item && item.hasAttribute("disabled")) {
				this._enterPointerMode(null)
				return
			}
			this._enterPointerMode(item)
		})
	}

	/**
	 * Enter pointer-driven selection. Drops the keyboard highlight so a hovered
	 * item is the only highlighted one; the pointer position is remembered so an
	 * arrow key can convert it into the keyboard selection.
	 */
	_enterPointerMode(item) {
		this._pointerActive = true
		this._pointerItem = item instanceof HTMLElement ? item : null
		const parts = getMenuItems(this)
		const active = document.activeElement
		if (active instanceof HTMLElement && parts.includes(active) && active !== item) {
			active.blur()
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

		// Reset pointer mode for a fresh menu.
		this._pointerItem = null
		this._pointerActive = false

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

		// Focus the first enabled menu item so arrow keys drive navigation
		// immediately. If the cursor already rests on one of our items (menu
		// opened under the mouse), leave pointer mode in charge instead.
		setTimeout(() => {
			const items = getMenuItems(this)
			if (items.length > 0 && this.hasAttribute("active")) {
				const el = PointerX >= 0 ? document.elementFromPoint(PointerX, PointerY) : null
				const hovered = el && el.closest ? el.closest("ui-menu-item") : null
				if (hovered && items.includes(hovered) && !hovered.hasAttribute("disabled")) {
					this._pointerActive = true
					this._pointerItem = hovered
				} else {
					items[0].focus({ preventScroll: true })
				}
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
		const activeIndex = currentIsItem ? items.indexOf(active) : -1
		// When pointer mode is active, an arrow key converts the hovered item
		// into the keyboard selection and continues from there.
		const pointerIndex = (!currentIsItem && this._pointerActive && this._pointerItem && items.includes(this._pointerItem))
			? items.indexOf(this._pointerItem)
			: -1

		let index = -1

		switch (e.key) {
			case "ArrowDown":
				index = currentIsItem ? (activeIndex + 1) % items.length
					: pointerIndex >= 0 ? (pointerIndex + 1) % items.length
					: 0
				break
			case "ArrowUp":
				index = currentIsItem ? (activeIndex - 1 + items.length) % items.length
					: pointerIndex >= 0 ? (pointerIndex - 1 + items.length) % items.length
					: items.length - 1
				break
			case "Home":
				index = 0
				break
			case "End":
				index = items.length - 1
				break
			case "Enter":
			case " ": {
				const victim = currentIsItem
					? active
					: (this._pointerActive && this._pointerItem && items.includes(this._pointerItem) ? this._pointerItem : null)
				if (victim && !victim.hasAttribute("disabled")) {
					e.preventDefault()
					e.stopImmediatePropagation()
					victim.click()
					return true
				}
				return false
			}
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
		// An arrow key means keyboard navigation takes over from the pointer.
		this._pointerActive = false
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

// Track the cursor so a menu that opens under the mouse starts in pointer mode.
document.addEventListener(
	"pointermove",
	(e) => {
		PointerX = e.clientX
		PointerY = e.clientY
	},
	{ capture: true, passive: true }
)

customElements.define("ui-menu", Menu);
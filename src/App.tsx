import React from 'react'
import './css/App.css'
import Game from './Game/Game'
import GameSave from './Game/Save/GameSave'
import GameView from './Views/GameView'

const REFRESH_RATE: number = 50
const TICK_BETWEEN_SAVE: number = 20
const STORAGE_NAME: string = 'game'

interface IAppState {
    game: Game
}

export default class App extends React.Component<any, IAppState> {
    private stop: boolean

    constructor (props: any) {
        super(props)
        this.stop = false
        this.state = {
            game: this.loadGame()
        }
    }

    componentDidMount (): void {
        this.stop = false
        void this.gameLoop()
    }

    componentWillUnmount (): void {
        this.stop = true
    }

    async gameLoop (): Promise<void> {
        let tickCount = 0
        while (!this.stop) {
            const startTime = Date.now()
            this.tick()
            tickCount++
            if (tickCount >= TICK_BETWEEN_SAVE) {
                tickCount = 0
                this.saveGame()
            }
            const tickTime = Date.now() - startTime
            if (tickTime <= REFRESH_RATE) { await sleep(REFRESH_RATE - tickTime) }
        }
    }

    tick (): void {
        this.state.game.update()
        this.setState({
            game: this.state.game
        })
    }

    saveGame (): void {
        const save = new GameSave(this.state.game)
        localStorage.setItem(STORAGE_NAME, JSON.stringify(save))
    }

    loadGame (): Game {
        const stringSave = localStorage.getItem(STORAGE_NAME)
        if (stringSave !== null && stringSave !== '') {
            const save = new GameSave(undefined, JSON.parse(stringSave))
            return save.getObj()
        } else {
            return new Game(undefined, undefined, undefined, true)
        }
    }

    clearGame (): void {
        localStorage.setItem(STORAGE_NAME, '')
        window.location.reload()
    }

    render (): JSX.Element {
        return (
            <div className="container-fluid">
                <button className="btn btn-primary" onClick={() => this.clearGame()}>Clear save</button>

                <button className="btn btn-primary" onClick={() => this.state.game.cheatMoney()}>Cheat 1000€</button>
                <GameView game={this.state.game} />
            </div>
        )
    }
}

async function sleep (ms: number): Promise<void> {
    return await new Promise(resolve => setTimeout(resolve, ms))
}

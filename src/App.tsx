/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useEffect, useState } from 'react'
import './css/App.css'
import Game from './Game/Game'
import startGameLoop from './Game/GameLoop'
import GameSave from './Game/Save/GameSave'
import GameView from './Views/GameView'

const STORAGE_NAME: string = 'game'

const saveGame = (): void => {
    const save = new GameSave(GAME)
    localStorage.setItem(STORAGE_NAME, JSON.stringify(save))
}

const loadGame = (): Game => {
    const stringSave = localStorage.getItem(STORAGE_NAME)
    if (stringSave !== null && stringSave !== '') {
        const save = new GameSave(undefined, JSON.parse(stringSave))
        return save.getObj()
    } else {
        return new Game(undefined, undefined, undefined, true)
    }
}

const clearGame = (): void => {
    localStorage.setItem(STORAGE_NAME, '')
    window.location.reload()
}

const GAME = loadGame()

const App = (): JSX.Element => {
    const [, setGame] = useState<Game>(GAME)

    const updateGame = (): void => {
        setGame(new Game(GAME.factory, GAME.money, GAME.inventory))
    }

    useEffect(() => {
        const stopLoop = startGameLoop(GAME, updateGame, saveGame)
        return () => {
            stopLoop()
        }
    }, [])

    return (
        <div className="container-fluid">
            <button className="btn btn-primary" onClick={() => clearGame()}>Clear save</button>

            <button className="btn btn-primary" onClick={() => {
                GAME.cheatMoney()
                console.log('cheat')
            }}>Cheat 1000€</button>
            <GameView game={GAME} />
        </div>
    )
}

export default App

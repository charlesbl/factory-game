import React, { useState } from 'react'
import FactoryView from './FactoryView'
import IBaseProps from './IBaseProps'
import Factory from '../Game/Factory'
import { notImplemented } from '..'

const goBack = (): void => {
    notImplemented()
    // if (this.state.selectedFactory.topFactory)
    //     this.changeFactory(this.state.selectedFactory.topFactory);
}

const GameView = (props: IBaseProps): JSX.Element => {
    const [selectedFactory, setFactory] = useState<Factory>(props.game.factory)

    return (
        <div>
            <span>{props.game.money.toFixed(2)}€</span>
            <FactoryView
                game={props.game}
                factory={selectedFactory}
                onSelectedFactory={(factory) => setFactory(factory)}
                onGoBack={() => goBack()} />
        </div>
    )
}

export default GameView
